// Abonos automáticos desde los avisos de depósito de Fondeadora que llegan a Gmail [F04, I03].
//
// Formato real del aviso (texto plano):
//   Recibiste un depósito
//   NOMBRE DEL ORDENANTE depositó $1,035.00 a tu cuenta  por el concepto de Packatelas CMX00114.
//   Clave de rastreo: CPO185773811242.
import { Prisma, type PrismaClient } from "../generated/prisma/client.ts";
import { audit } from "./orders.ts";
import { refreshBlockedPickups } from "./pickups.ts";

export type FondeadoraDeposit = { sender: string; amount: string; concept: string; trackingKey: string };

/** Extrae ordenante, monto, concepto y clave de rastreo; null si el correo no es un depósito. */
export function parseFondeadoraDeposit(text: string): FondeadoraDeposit | null {
  const t = text.replace(/\r/g, "").replace(/[ \t]+/g, " ");
  if (!/Recibiste un dep[oó]sito/i.test(t)) return null;
  const m = t.match(/\n?\s*(.+?) deposit[oó] \$\s?([\d,]+(?:\.\d{1,2})?) a tu cuenta\s*por el concepto de ([^\n]*?)\.?\s*(?:\n|$)/i);
  const k = t.match(/Clave de rastreo:\s*([A-Za-z0-9]+)/i);
  if (!m || !k) return null;
  const amount = m[2].replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(amount) || Number(amount) <= 0) return null;
  return { sender: m[1].trim(), amount: Number(amount).toFixed(2), concept: m[3].trim(), trackingKey: k[1].toUpperCase() };
}

export type ClientRef = { id: string; publicId: string; paymentReference: string };
export type MatchResult =
  | { kind: "exact"; clientId: string; via: string }
  | { kind: "suggestion"; note: string }
  | { kind: "none" };

/**
 * Identifica al cliente por el concepto. Exacto: ID público (cmx00114, cmx00127-granjas) o
 * referencia de pago (PKT00114). Si hay error de dedo en el prefijo (emx00141) o el número
 * corresponde a varias subcuentas, NO se aplica solo: queda como sugerencia para revisión.
 */
export function matchClient(concept: string, clients: ClientRef[]): MatchResult {
  const c = concept.toLowerCase();
  const byPublic = new Map(clients.map((x) => [x.publicId.toLowerCase(), x]));
  const byRef = new Map(clients.map((x) => [x.paymentReference.toLowerCase(), x]));

  // 1) Referencia de pago o ID público completo (incluidas subcuentas con sufijo)
  for (const tok of c.match(/[a-z]{3}\d{3,6}(?:-[a-z0-9]+)?/g) ?? []) {
    const hit = byRef.get(tok) ?? byPublic.get(tok);
    if (hit) return { kind: "exact", clientId: hit.id, via: tok };
  }
  // 2) cmx + número sin sufijo: exacto solo si existe ese ID sin subcuentas
  const nums = [...c.matchAll(/(?:^|[^a-z0-9])([a-z]{0,2})mx[\s-]?0*(\d{1,6})(?![0-9])/g)];
  for (const [, prefix, n] of nums) {
    const base = `cmx${n.padStart(5, "0")}`;
    const family = clients.filter((x) => x.publicId.toLowerCase() === base || x.publicId.toLowerCase().startsWith(`${base}-`));
    if (prefix === "c" && family.length === 1 && family[0].publicId.toLowerCase() === base) {
      return { kind: "exact", clientId: family[0].id, via: base };
    }
    if (family.length) {
      return { kind: "suggestion", note: `Posible ${family.map((f) => f.publicId).join(" o ")} (concepto: "${concept}")` };
    }
  }
  return { kind: "none" };
}

export type IngestResult = { status: "applied" | "unidentified" | "duplicate" | "ignored"; paymentId?: string; clientId?: string };

/**
 * Registra un aviso de depósito. Idempotente por id de correo y por clave de rastreo:
 * leer el mismo correo dos veces nunca abona dos veces.
 */
export async function ingestFondeadoraEmail(
  prisma: PrismaClient,
  email: { externalId: string; receivedAt: Date; text: string },
): Promise<IngestResult> {
  const dep = parseFondeadoraDeposit(email.text);
  if (!dep) return { status: "ignored" };

  const dup = await prisma.payment.findFirst({
    where: { OR: [{ externalId: email.externalId }, { trackingKey: dep.trackingKey }] },
    select: { id: true },
  });
  if (dup) return { status: "duplicate", paymentId: dup.id };

  const clients = await prisma.client.findMany({ select: { id: true, publicId: true, paymentReference: true } });
  const match = matchClient(dep.concept, clients);

  try {
    const result = await prisma.$transaction(async (tx) => {
      const payment = await tx.payment.create({
        data: {
          clientId: match.kind === "exact" ? match.clientId : null,
          method: "TRANSFER",
          source: "GMAIL",
          status: match.kind === "exact" ? "APPLIED" : "UNIDENTIFIED",
          amount: new Prisma.Decimal(dep.amount),
          reference: dep.concept.slice(0, 120),
          trackingKey: dep.trackingKey,
          senderName: dep.sender.slice(0, 120),
          receivedAt: email.receivedAt,
          externalId: email.externalId,
          note: match.kind === "suggestion" ? match.note.slice(0, 300) : undefined,
        },
      });
      if (match.kind === "exact") {
        await tx.ledgerEntry.create({
          data: {
            clientId: match.clientId,
            type: "PAYMENT",
            amount: new Prisma.Decimal(dep.amount).neg(),
            description: `Abono por transferencia · ${dep.trackingKey}`,
            paymentId: payment.id,
          },
        });
        await audit(tx, {
          action: "payment.auto_applied",
          entity: "Payment",
          entityId: payment.id,
          summary: `Transferencia de $${dep.amount} de ${dep.sender} aplicada automáticamente (${match.via})`,
        });
      }
      return payment;
    });
    if (match.kind === "exact") await refreshBlockedPickups(prisma, match.clientId);
    return { status: match.kind === "exact" ? "applied" : "unidentified", paymentId: result.id, clientId: result.clientId ?? undefined };
  } catch (e) {
    // El mismo correo procesado en paralelo: gana el índice único.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { status: "duplicate" };
    throw e;
  }
}

/** Marca un pago como "no es de cliente" (traspasos propios, Mercado Pago, etc.). */
export async function dismissPayment(prisma: PrismaClient, paymentId: string, actorUserId?: string) {
  const p = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
  if (p.status !== "UNIDENTIFIED") throw new Error("Solo se descartan pagos sin identificar");
  await prisma.payment.update({ where: { id: p.id }, data: { status: "REJECTED", appliedById: actorUserId } });
  await audit(prisma, { actorUserId, action: "payment.dismissed", entity: "Payment", entityId: p.id, summary: `Depósito de $${p.amount.toFixed(2)} marcado como no es de cliente` });
}
