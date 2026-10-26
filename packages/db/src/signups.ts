// Registro de clientes nuevos [C01]: el formulario público crea una solicitud; al aprobarla
// se crean el cliente (ID cmx/emx), su sucursal de recolección y su usuario del portal.
import { Prisma, type PrismaClient } from "../generated/prisma/client.ts";
import { audit } from "./orders.ts";
import { hashPassword } from "./password.ts";
import { ID_PREFIXES, referenceFromPublicId, type IdPrefix } from "./public-id.ts";

type Db = PrismaClient | Prisma.TransactionClient;

/** Siguiente ID de la zona (cmx00001… / emx00001…) según el mayor existente. */
export async function nextPublicId(db: Db, prefix: IdPrefix) {
  const rows = await db.$queryRaw<{ max: number | null }[]>`
    SELECT MAX(CAST(SUBSTRING("publicId" FROM '^[a-z]{3}([0-9]+)') AS INTEGER)) AS max
    FROM "Client" WHERE "publicId" ~ ${`^${prefix}[0-9]+(-|$)`}`;
  const publicId = `${prefix}${String((rows[0]?.max ?? 0) + 1).padStart(5, "0")}`;
  return { publicId, paymentReference: referenceFromPublicId(publicId) };
}

export type SignupInput = {
  businessName: string;
  contactName: string;
  phone: string;
  email: string;
  zone: IdPrefix;
  pickupAddress: string;
  pickupReference?: string;
  monthlyVolume?: string;
  salesChannels?: string;
  rfc?: string;
  legalName?: string;
  taxRegime?: string;
  taxZip?: string;
  cfdiUse?: string;
  username: string;
  password: string;
  ip?: string;
};

export type SignupResult = { ok: true; id: string } | { ok: false; error: string };

export async function submitSignup(prisma: PrismaClient, input: SignupInput): Promise<SignupResult> {
  const username = input.username.trim().toLowerCase();
  const email = input.email.trim().toLowerCase();
  if (!ID_PREFIXES.includes(input.zone)) return { ok: false, error: "Zona inválida" };
  if (input.password.length < 8) return { ok: false, error: "La contraseña debe tener al menos 8 caracteres" };

  const [userTaken, emailTaken, pendingSame, recentFromIp] = await Promise.all([
    prisma.user.findUnique({ where: { username }, select: { id: true } }),
    prisma.user.findFirst({ where: { email }, select: { id: true } }),
    prisma.clientSignup.findFirst({ where: { status: "PENDING", OR: [{ username }, { email }, { phone: input.phone }] }, select: { username: true } }),
    input.ip
      ? prisma.clientSignup.count({ where: { ip: input.ip, createdAt: { gt: new Date(Date.now() - 3600_000) } } })
      : Promise.resolve(0),
  ]);
  if (userTaken) return { ok: false, error: "Ese usuario ya existe; elige otro" };
  if (emailTaken) return { ok: false, error: "Ese correo ya tiene cuenta. Si olvidaste tu acceso, escríbenos." };
  if (pendingSame) return { ok: false, error: "Ya tenemos una solicitud tuya en revisión; te contactaremos pronto." };
  if (recentFromIp >= 5) return { ok: false, error: "Demasiadas solicitudes; intenta más tarde." };

  const s = await prisma.clientSignup.create({
    data: {
      businessName: input.businessName.trim(),
      contactName: input.contactName.trim(),
      phone: input.phone.trim(),
      email,
      zone: input.zone,
      pickupAddress: input.pickupAddress.trim(),
      pickupReference: input.pickupReference?.trim() || null,
      monthlyVolume: input.monthlyVolume?.trim() || null,
      salesChannels: input.salesChannels?.trim() || null,
      rfc: input.rfc?.trim().toUpperCase() || null,
      legalName: input.legalName?.trim() || null,
      taxRegime: input.taxRegime?.trim() || null,
      taxZip: input.taxZip?.trim() || null,
      cfdiUse: input.cfdiUse?.trim() || null,
      username,
      passwordHash: await hashPassword(input.password),
      termsAcceptedAt: new Date(),
      ip: input.ip ?? null,
    },
  });
  return { ok: true, id: s.id };
}

export type ApproveResult = { ok: true; clientId: string; publicId: string } | { ok: false; error: string };

/** Aprueba la solicitud: crea cliente, sucursal y usuario en una sola transacción. */
export async function approveSignup(
  prisma: PrismaClient,
  input: { signupId: string; tariffAmount: number; zone?: IdPrefix; note?: string },
  actorUserId?: string,
): Promise<ApproveResult> {
  if (!(input.tariffAmount >= 0 && input.tariffAmount <= 100000)) return { ok: false, error: "Tarifa inválida" };
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('client-ids'))`;
    const [s] = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "ClientSignup" WHERE id = ${input.signupId} FOR UPDATE`;
    if (!s) return { ok: false as const, error: "Solicitud no encontrada" };
    const signup = await tx.clientSignup.findUniqueOrThrow({ where: { id: input.signupId } });
    if (signup.status !== "PENDING") return { ok: false as const, error: "Esta solicitud ya se revisó" };
    if (await tx.user.findUnique({ where: { username: signup.username } })) {
      return { ok: false as const, error: `El usuario "${signup.username}" ya se ocupó; recházala y pide que se registre con otro` };
    }
    const zone = input.zone ?? (signup.zone as IdPrefix);
    const ids = await nextPublicId(tx, zone);
    const client = await tx.client.create({
      data: {
        ...ids,
        name: signup.businessName,
        contactName: signup.contactName,
        phone: signup.phone,
        email: signup.email,
        rfc: signup.rfc,
        legalName: signup.legalName,
        taxRegime: signup.taxRegime,
        taxZip: signup.taxZip,
        cfdiUse: signup.cfdiUse,
        tariffAmount: new Prisma.Decimal(input.tariffAmount),
        branches: {
          create: {
            name: "Principal",
            address: signup.pickupReference ? `${signup.pickupAddress} (${signup.pickupReference})` : signup.pickupAddress,
            phone: signup.phone,
          },
        },
      },
    });
    await tx.user.create({
      data: {
        username: signup.username,
        email: (await tx.user.findFirst({ where: { email: signup.email } })) ? null : signup.email,
        name: signup.contactName,
        passwordHash: signup.passwordHash,
        role: "CLIENTE",
        clientId: client.id,
      },
    });
    await tx.clientSignup.update({
      where: { id: signup.id },
      data: { status: "APPROVED", clientId: client.id, reviewedById: actorUserId, reviewedAt: new Date(), reviewNote: input.note?.slice(0, 300) },
    });
    await audit(tx, {
      actorUserId,
      action: "client.signup_approved",
      entity: "Client",
      entityId: client.id,
      summary: `Registro aprobado: ${client.name} (${client.publicId}), tarifa $${input.tariffAmount}`,
    });
    return { ok: true as const, clientId: client.id, publicId: client.publicId };
  });
}

export async function rejectSignup(prisma: PrismaClient, signupId: string, note: string, actorUserId?: string) {
  const r = await prisma.clientSignup.updateMany({
    where: { id: signupId, status: "PENDING" },
    data: { status: "REJECTED", reviewedById: actorUserId, reviewedAt: new Date(), reviewNote: note.slice(0, 300) || null },
  });
  if (r.count) await audit(prisma, { actorUserId, action: "client.signup_rejected", entity: "ClientSignup", entityId: signupId, summary: `Registro rechazado${note ? `: ${note}` : ""}` });
  return r.count > 0;
}
