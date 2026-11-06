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

const AUTO_NOTE = "Alta automática al crear su usuario de repartidor.";

/**
 * Empleado sin usuario que coincide con la persona. Si hay varios, se queda con el único ACTIVO;
 * si aun así hay duda, no se liga. Un nombre de una sola palabra («marlon») solo liga si hay un único
 * empleado activo sin usuario cuyo nombre empieza con ella.
 */
export async function matchEmployee(db: Db, p: Person, opts: { excludeId?: string } = {}) {
  const free = (await db.employee.findMany({ where: { userId: null }, select: { id: true, employeeNo: true, name: true, phone: true, email: true, status: true, notes: true } }))
    .filter((e) => e.id !== opts.excludeId && !e.notes?.startsWith(AUTO_NOTE));
  const pick = <T extends { status: string }>(list: T[]) => (list.length === 1 ? list[0] : list.filter((e) => e.status === "ACTIVO").length === 1 ? list.find((e) => e.status === "ACTIVO")! : null);
  const ph = phone10(p.phone);
  const em = p.email?.trim().toLowerCase();
  const byPhone = pick(ph ? free.filter((e) => phone10(e.phone) === ph) : []);
  if (byPhone) return { employee: byPhone, by: "teléfono" as const };
  const byEmail = pick(em ? free.filter((e) => e.email?.trim().toLowerCase() === em) : []);
  if (byEmail) return { employee: byEmail, by: "correo" as const };
  const byName = pick(free.filter((e) => sameName(e.name, p.name)));
  if (byName) return { employee: byName, by: "nombre" as const };
  const single = nameTokens(p.name);
  if (single.length === 1 && single[0].length >= 4) {
    const firsts = free.filter((e) => e.status === "ACTIVO" && nameTokens(e.name.split(/\s+/)[0])[0] === single[0]);
    if (firsts.length === 1) return { employee: firsts[0], by: "nombre" as const };
  }
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
            notes: `${AUTO_NOTE} Falta registrar su huella en el checador.`,
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
  const fixed = await reconcileAutoEmployees(prisma).catch((e) => { console.error("[empleados] corrección", e); return []; });
  if (fixed.length) {
    await sendPush(prisma, await adminUserIds(prisma), {
      title: "Corrección de empleados",
      body: `Ligados a su empleado de antes: ${fixed.map((f) => `${f.name} → #${f.to} (se quitó #${f.from})`).join(", ")}`,
      url: "/admin/personal", tag: "driver-employees-fix",
    }).catch(() => null);
  }
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

/** Empleados creados solos que aún no tienen checadas, documentos ni nómina (se pueden corregir sin perder nada). */
async function untouchedAuto(db: Db) {
  return db.employee.findMany({
    where: { notes: { startsWith: AUTO_NOTE }, punches: { none: {} }, employeeDocuments: { none: {} }, payroll: { none: {} } },
    select: { id: true, employeeNo: true, name: true, phone: true, email: true, userId: true, user: { select: { id: true, name: true, username: true, email: true, lastLoginAt: true, driver: { select: { phone: true, lastLocationAt: true } } } } },
    orderBy: { employeeNo: "asc" },
  });
}

/**
 * Corrige altas automáticas: si con las reglas actuales su repartidor sí coincide con un empleado
 * que ya existía (sin usuario), se liga a ese y se borra el que se creó de más.
 */
export async function reconcileAutoEmployees(prisma: PrismaClient) {
  const fixed: { from: number; to: number; name: string; by: string }[] = [];
  for (const a of await untouchedAuto(prisma)) {
    if (!a.user) continue;
    const m = await matchEmployee(prisma, { name: a.user.name, phone: a.user.driver?.phone ?? a.phone, email: a.user.email }, { excludeId: a.id });
    if (!m) continue;
    await prisma.$transaction(async (tx) => {
      await tx.employee.delete({ where: { id: a.id } });
      await tx.employee.update({ where: { id: m.employee.id }, data: { userId: a.user!.id, kind: "repartidor" } });
    });
    await audit(prisma, { action: "employee.linked_driver", entity: "Employee", entityId: m.employee.id, summary: `Corrección: ${a.user.name} ligado al empleado #${m.employee.employeeNo} ${m.employee.name} (coincide por ${m.by}); se quitó el #${a.employeeNo} creado de más` });
    fixed.push({ from: a.employeeNo, to: m.employee.employeeNo, name: a.user.name, by: m.by });
  }
  return fixed;
}

export type DuplicateCase = {
  autoId: string; autoNo: number; userId: string; user: string; username: string; lastSeen: Date | null;
  others: { employeeId: string; employeeNo: number; name: string; userId: string | null; username: string | null; lastSeen: Date | null; status: string }[];
};

/**
 * Altas automáticas que se parecen (nombre o teléfono) a un empleado que ya tiene OTRO usuario:
 * casi siempre es la misma persona con dos usuarios. Lo decide administración.
 */
export async function driverDuplicateCases(db: Db): Promise<DuplicateCase[]> {
  const autos = await untouchedAuto(db);
  if (!autos.length) return [];
  const all = await db.employee.findMany({ select: { id: true, employeeNo: true, name: true, phone: true, status: true, userId: true, user: { select: { username: true, lastLoginAt: true, driver: { select: { lastLocationAt: true } } } } } });
  const seen = (u: { lastLoginAt: Date | null; driver: { lastLocationAt: Date | null } | null } | null) => {
    const ts = [u?.lastLoginAt, u?.driver?.lastLocationAt].filter((d): d is Date => !!d).map((d) => d.getTime());
    return ts.length ? new Date(Math.max(...ts)) : null;
  };
  const out: DuplicateCase[] = [];
  for (const a of autos) {
    if (!a.user) continue;
    const ph = phone10(a.user.driver?.phone ?? a.phone);
    const others = all.filter((e) => e.id !== a.id && (sameName(e.name, a.user!.name) || (ph && phone10(e.phone) === ph)));
    if (!others.length) continue;
    out.push({
      autoId: a.id, autoNo: a.employeeNo, userId: a.user.id, user: a.user.name, username: a.user.username, lastSeen: seen(a.user),
      others: others.map((e) => ({ employeeId: e.id, employeeNo: e.employeeNo, name: e.name, userId: e.userId, username: e.user?.username ?? null, lastSeen: seen(e.user), status: e.status })),
    });
  }
  return out;
}

/**
 * Es la misma persona: el usuario `keepUserId` se queda con el empleado `employeeId`; el alta
 * automática se borra y el otro usuario de repartidor (si había) se desactiva.
 */
export async function mergeDriverDuplicate(prisma: PrismaClient, input: { autoId: string; employeeId: string; keepUserId: string }, actorUserId: string) {
  const [auto, target] = await Promise.all([
    prisma.employee.findUnique({ where: { id: input.autoId }, select: { id: true, employeeNo: true, notes: true, userId: true, _count: { select: { punches: true, employeeDocuments: true, payroll: true } } } }),
    prisma.employee.findUnique({ where: { id: input.employeeId }, select: { id: true, employeeNo: true, name: true, userId: true } }),
  ]);
  if (!auto || !target || !auto.notes?.startsWith(AUTO_NOTE)) throw new Error("Ya no aplica; recarga la página");
  if (auto._count.punches + auto._count.employeeDocuments + auto._count.payroll > 0) throw new Error(`El #${auto.employeeNo} ya tiene checadas o documentos; corrígelo a mano`);
  const users = [auto.userId, target.userId].filter((u): u is string => !!u);
  if (!users.includes(input.keepUserId)) throw new Error("Usuario inválido");
  const drop = users.filter((u) => u !== input.keepUserId);
  await prisma.$transaction(async (tx) => {
    await tx.employee.delete({ where: { id: auto.id } });
    await tx.employee.update({ where: { id: target.id }, data: { userId: input.keepUserId, kind: "repartidor" } });
    for (const u of drop) {
      await tx.user.update({ where: { id: u }, data: { active: false } });
      await tx.driver.updateMany({ where: { userId: u }, data: { active: false, onDuty: false } });
      await tx.session.deleteMany({ where: { userId: u } });
    }
  });
  await audit(prisma, { actorUserId, action: "employee.merged_driver", entity: "Employee", entityId: target.id, summary: `Misma persona: empleado #${target.employeeNo} ${target.name} queda con un solo usuario; se quitó el #${auto.employeeNo} y se desactivó ${drop.length} usuario(s) duplicado(s)` });
}

/** Es otra persona: el alta automática se queda (deja de aparecer como posible duplicado). */
export async function keepAutoEmployee(prisma: PrismaClient, autoId: string, actorUserId: string) {
  const e = await prisma.employee.findUniqueOrThrow({ where: { id: autoId }, select: { notes: true, employeeNo: true } });
  await prisma.employee.update({ where: { id: autoId }, data: { notes: (e.notes ?? "").replace(AUTO_NOTE, "Alta automática (revisada: es otra persona).") } });
  await audit(prisma, { actorUserId, action: "employee.auto_confirmed", entity: "Employee", entityId: autoId, summary: `Empleado #${e.employeeNo}: confirmado como persona distinta` });
}

/**
 * Misma persona con varios expedientes: `keepEmployeeId` se queda (con el usuario `keepUserId`) y
 * recibe las checadas, justificaciones, documentos, recibos, cargos y registros de flotilla de los
 * demás. Los que sobran: si son altas automáticas vacías se borran; si no, quedan de baja como
 * «duplicado». Los otros usuarios se desactivan.
 */
export async function mergeEmployees(prisma: PrismaClient, input: { keepEmployeeId: string; dropEmployeeIds: string[]; keepUserId: string | null }, actorUserId: string) {
  const ids = [...new Set(input.dropEmployeeIds)].filter((x) => x !== input.keepEmployeeId);
  if (!ids.length) throw new Error("Elige qué número(s) se quitan");
  const all = await prisma.employee.findMany({
    where: { id: { in: [input.keepEmployeeId, ...ids] } },
    select: { id: true, employeeNo: true, name: true, userId: true, notes: true, _count: { select: { punches: true, employeeDocuments: true, payroll: true } } },
  });
  const keep = all.find((e) => e.id === input.keepEmployeeId);
  if (!keep || all.length !== ids.length + 1) throw new Error("Algún empleado ya no existe; recarga");
  const users = all.map((e) => e.userId).filter((u): u is string => !!u);
  if (input.keepUserId && !users.includes(input.keepUserId)) throw new Error("El usuario elegido no es de estos expedientes");
  const keepUser = input.keepUserId ?? keep.userId;
  const drops = all.filter((e) => e.id !== keep.id);

  await prisma.$transaction(async (tx) => {
    // El usuario que se queda se libera de su expediente actual para ligarlo al que se queda.
    await tx.employee.updateMany({ where: { id: { in: ids } }, data: { userId: null } });
    for (const d of drops) {
      // Checadas: las que caen en el mismo instante ya existen en el que se queda.
      const punches = await tx.punch.findMany({ where: { employeeId: d.id }, select: { id: true, at: true } });
      for (const p of punches) {
        const clash = await tx.punch.findUnique({ where: { employeeId_at: { employeeId: keep.id, at: p.at } }, select: { id: true } });
        if (clash) await tx.punch.delete({ where: { id: p.id } });
        else await tx.punch.update({ where: { id: p.id }, data: { employeeId: keep.id } });
      }
      const receipts = await tx.payrollReceipt.findMany({ where: { employeeId: d.id }, select: { id: true, quincena: true } });
      for (const r of receipts) {
        const clash = await tx.payrollReceipt.findUnique({ where: { employeeId_quincena: { employeeId: keep.id, quincena: r.quincena } }, select: { id: true } });
        if (!clash) await tx.payrollReceipt.update({ where: { id: r.id }, data: { employeeId: keep.id } });
      }
      await tx.justification.updateMany({ where: { employeeId: d.id }, data: { employeeId: keep.id } });
      await tx.employeeDocument.updateMany({ where: { employeeId: d.id }, data: { employeeId: keep.id } });
      await tx.employeeCharge.updateMany({ where: { employeeId: d.id }, data: { employeeId: keep.id } });
      await tx.vehicleCheck.updateMany({ where: { employeeId: d.id }, data: { employeeId: keep.id } });
      await tx.fuelLoad.updateMany({ where: { employeeId: d.id }, data: { employeeId: keep.id } });
      await tx.fault.updateMany({ where: { reportedById: d.id }, data: { reportedById: keep.id } });
      await tx.fault.updateMany({ where: { responsibleId: d.id }, data: { responsibleId: keep.id } });
      await tx.repair.updateMany({ where: { responsibleId: d.id }, data: { responsibleId: keep.id } });
      const left = await tx.payrollReceipt.count({ where: { employeeId: d.id } });
      const empty = d.notes?.startsWith(AUTO_NOTE) && d._count.punches + d._count.employeeDocuments + d._count.payroll === 0 && !left;
      if (empty) {
        await tx.hireApplication.updateMany({ where: { employeeId: d.id }, data: { employeeId: null } });
        await tx.employee.delete({ where: { id: d.id } });
      } else {
        await tx.employee.update({
          where: { id: d.id },
          data: { status: "BAJA", endDate: new Date(), notes: `Duplicado: es la misma persona que el #${keep.employeeNo}; su historial pasó a ese número.${d.notes ? ` ${d.notes}` : ""}`.slice(0, 1000) },
        });
      }
    }
    await tx.employee.update({ where: { id: keep.id }, data: { userId: keepUser, status: "ACTIVO", endDate: null, kind: "repartidor" } });
    for (const u of users.filter((x) => x !== keepUser)) {
      await tx.user.update({ where: { id: u }, data: { active: false } });
      await tx.driver.updateMany({ where: { userId: u }, data: { active: false, onDuty: false } });
      await tx.session.deleteMany({ where: { userId: u } });
    }
  });
  await audit(prisma, {
    actorUserId, action: "employee.merged", entity: "Employee", entityId: keep.id,
    summary: `Misma persona: se queda el #${keep.employeeNo} ${keep.name}; se quitaron ${drops.map((d) => `#${d.employeeNo}`).join(", ")}; usuarios desactivados: ${users.filter((x) => x !== keepUser).length}`,
  });
  return { kept: keep.employeeNo, dropped: drops.map((d) => d.employeeNo) };
}

/** Una vez al día: aviso a los repartidores activos que aún no vinculan su ID de driver Flex. */
export async function remindFlexLink(prisma: PrismaClient, now = new Date()) {
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(now);
  const key = "flex.reminder.day";
  if (((await prisma.setting.findUnique({ where: { key } }))?.value as string | undefined) === ymd) return 0;
  await prisma.setting.upsert({ where: { key }, update: { value: ymd }, create: { key, value: ymd } });
  const drivers = await prisma.driver.findMany({ where: { active: true, flexExempt: false, flexIdentities: { none: {} }, user: { active: true } }, select: { userId: true } });
  if (!drivers.length) return 0;
  await sendPush(prisma, drivers.map((d) => d.userId), {
    title: "Vincula tu Mercado Libre Flex",
    body: "Es obligatorio: sin este paso los pedidos que tomas en Flex no se te asignan. Abre la app y escanea un paquete que ya tomaste en Flex.",
    url: "/repartidor", tag: "flex-link",
  }).catch(() => null);
  return drivers.length;
}
