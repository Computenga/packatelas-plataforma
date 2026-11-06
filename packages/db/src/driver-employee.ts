// Cada repartidor es también un empleado (expediente, número del checador, nómina).
// - Si ya hay un empleado sin usuario que coincide (teléfono, correo o nombre), se vinculan.
// - Si no, se crea su empleado con el siguiente número consecutivo (el que se registra en el
//   checador) y se avisa a administración para ponerle su huella.
// - En su app se le pide completar sus datos de expediente.
import type { Prisma, PrismaClient } from "../generated/prisma/client.ts";
import { getCounters, markCounter } from "./counters.ts";
import { audit } from "./orders.ts";
import { adminUserIds, sendPush } from "./push.ts";

type Db = PrismaClient | Prisma.TransactionClient;

/** «José  Isaías Javier» → ["isaias", "javier", "jose"] (sin acentos, ordenado). */
export const nameTokens = (s?: string | null) =>
  (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter((w) => w.length > 1).sort();
const phone10 = (s?: string | null) => {
  const d = (s ?? "").replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : null;
};

/**
 * ¿Es la misma persona por nombre? Mismas palabras en cualquier orden, o todas las palabras del
 * nombre más corto (al menos dos) dentro del más largo («Jose Isaias Javier» ⊂ «Jose Isaias Javier Lopez»).
 */
export function sameName(a?: string | null, b?: string | null) {
  const x = nameTokens(a), y = nameTokens(b);
  if (x.length < 2 || y.length < 2) return false;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.every((w) => long.includes(w));
}

type Person = { name: string; phone?: string | null; email?: string | null };

/** Empleado sin usuario que coincide con la persona; solo si hay uno solo (si hay duda, no se liga). */
export async function matchEmployee(db: Db, p: Person) {
  const free = await db.employee.findMany({ where: { userId: null }, select: { id: true, employeeNo: true, name: true, phone: true, email: true, status: true } });
  const ph = phone10(p.phone);
  const em = p.email?.trim().toLowerCase();
  const byPhone = ph ? free.filter((e) => phone10(e.phone) === ph) : [];
  if (byPhone.length === 1) return { employee: byPhone[0], by: "teléfono" as const };
  const byEmail = em ? free.filter((e) => e.email?.trim().toLowerCase() === em) : [];
  if (byEmail.length === 1) return { employee: byEmail[0], by: "correo" as const };
  const byName = free.filter((e) => sameName(e.name, p.name));
  if (byName.length === 1) return { employee: byName[0], by: "nombre" as const };
  return null;
}

/** Siguiente número de empleado: el mayor entre el consecutivo registrado y los que ya existen, +1. */
export async function nextEmployeeNo(db: Db) {
  const [c, max] = await Promise.all([getCounters(db), db.employee.aggregate({ where: { employeeNo: { lt: 100_000 } }, _max: { employeeNo: true } })]);
  return Math.max(c.empleado < 100_000 ? c.empleado : 0, max._max.employeeNo ?? 0) + 1;
}

/** Datos del expediente que el repartidor aún no llena. */
export function missingEmployeeData(e: { rfc: string | null; curp: string | null; nss: string | null; address: string | null; clabe: string | null; emergency: unknown; phone: string | null }) {
  const out: string[] = [];
  if (!e.curp) out.push("CURP");
  if (!e.rfc) out.push("RFC");
  if (!e.nss) out.push("NSS");
  if (!e.phone) out.push("celular");
  if (!e.address) out.push("domicilio");
  if (!e.clabe) out.push("CLABE");
  if (!e.emergency) out.push("contacto de emergencia");
  return out;
}

export type DriverEmployeeResult = { status: "exists" | "linked" | "created"; employeeNo: number; name: string; by?: string };

/** Asegura que el usuario repartidor tenga su empleado (vincula o crea). Idempotente. */
export async function ensureDriverEmployee(prisma: PrismaClient, userId: string, actorUserId?: string): Promise<DriverEmployeeResult | null> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true, email: true, role: true, active: true, employee: { select: { employeeNo: true } }, driver: { select: { phone: true } } } });
  if (!user || user.role !== "REPARTIDOR" || !user.driver) return null;
  if (user.employee) return { status: "exists", employeeNo: user.employee.employeeNo, name: user.name };
  const person = { name: user.name, phone: user.driver.phone, email: user.email };

  const m = await matchEmployee(prisma, person);
  if (m) {
    const linked = await prisma.employee.updateMany({ where: { id: m.employee.id, userId: null }, data: { userId: user.id, kind: "repartidor", ...(person.phone && !m.employee.phone ? { phone: phone10(person.phone) } : {}) } });
    if (linked.count) {
      await audit(prisma, { actorUserId, action: "employee.linked_driver", entity: "Employee", entityId: m.employee.id, summary: `Repartidor ${user.name} vinculado al empleado #${m.employee.employeeNo} ${m.employee.name} (coincide por ${m.by})` });
      return { status: "linked", employeeNo: m.employee.employeeNo, name: m.employee.name, by: m.by };
    }
  }

  // Alta con el siguiente consecutivo (reintenta si otro proceso lo tomó en el mismo instante).
  for (let i = 0; i < 5; i++) {
    const no = await nextEmployeeNo(prisma);
    try {
      const emp = await prisma.$transaction(async (tx) => {
        const e = await tx.employee.create({
          data: {
            employeeNo: no, name: user.name, phone: phone10(person.phone), email: user.email, userId: user.id, kind: "repartidor", position: "Repartidor",
            status: "ACTIVO", hireDate: new Date(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date())),
            notes: "Alta automática al crear su usuario de repartidor. Falta registrar su huella en el checador.",
          },
        });
        await markCounter(tx, "empleado", no);
        return e;
      });
      await audit(prisma, { actorUserId, action: "employee.created_for_driver", entity: "Employee", entityId: emp.id, summary: `Empleado #${no} creado para el repartidor ${user.name}` });
      return { status: "created", employeeNo: no, name: user.name };
    } catch (e) {
      if ((e as { code?: string }).code !== "P2002") throw e;
    }
  }
  throw new Error("No se pudo asignar número de empleado");
}

/**
 * Revisa a todos los repartidores (al crearlos y cada rato en segundo plano): vincula o crea su
 * empleado, avisa a administración qué número se asignó y le pide al repartidor llenar sus datos.
 */
export async function syncDriverEmployees(prisma: PrismaClient, actorUserId?: string) {
  const users = await prisma.user.findMany({ where: { role: "REPARTIDOR", active: true, employee: null, driver: { is: { active: true } } }, select: { id: true } });
  const results: DriverEmployeeResult[] = [];
  for (const u of users) {
    const r = await ensureDriverEmployee(prisma, u.id, actorUserId).catch((e) => { console.error("[empleados] repartidor", u.id, e); return null; });
    if (!r || r.status === "exists") continue;
    results.push(r);
    await notifyDriverData(prisma, u.id).catch(() => null);
  }
  const created = results.filter((r) => r.status === "created");
  const linked = results.filter((r) => r.status === "linked");
  if (results.length) {
    await sendPush(prisma, await adminUserIds(prisma), {
      title: created.length ? `Huella en el checador: ${created.map((r) => `#${r.employeeNo} ${r.name.split(" ")[0]}`).join(", ")}` : "Repartidores vinculados a su empleado",
      body: [created.length && `Empleado(s) nuevo(s) para repartidores: ${created.map((r) => `#${r.employeeNo} ${r.name}`).join(", ")}. Regístrales su huella con ese número.`,
        linked.length && `Vinculados: ${linked.map((r) => `${r.name} → #${r.employeeNo} (${r.by})`).join(", ")}.`].filter(Boolean).join(" "),
      url: "/admin/personal",
      tag: "driver-employees",
    }).catch(() => null);
  }
  return { created, linked };
}

/** Aviso al repartidor para que llene los datos de su expediente (si le faltan). */
export async function notifyDriverData(prisma: PrismaClient, userId: string) {
  const e = await prisma.employee.findUnique({ where: { userId }, select: { rfc: true, curp: true, nss: true, address: true, clabe: true, emergency: true, phone: true } });
  if (!e || !missingEmployeeData(e).length) return false;
  await sendPush(prisma, [userId], { title: "Completa tus datos", body: "Llena tus datos de expediente (CURP, RFC, NSS, domicilio, CLABE y contacto de emergencia) en tu perfil.", url: "/repartidor/perfil#expediente", tag: "mis-datos" });
  return true;
}
