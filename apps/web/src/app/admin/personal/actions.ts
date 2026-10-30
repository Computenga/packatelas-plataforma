"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  audit, hashPassword, importEmployees, importPunches, normalizePunchKind, parseClock, parseWorkdays, prisma, Prisma,
} from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import { parseEmployees, parsePunches } from "@/lib/personnel-import";
import type { ActionState } from "@/components/action-form";
import { formText } from "@/lib/form-text";

const opt = (max: number) => z.string().trim().max(max).optional().transform((v) => (v ? v : null));
const schema = z.object({
  employeeNo: z.coerce.number().int().min(1, "Número de empleado inválido").max(999999),
  name: z.string().trim().min(3, "Escribe el nombre completo").max(160),
  rfc: opt(13), curp: opt(18), nss: opt(11), position: opt(80), area: opt(80), kind: opt(40),
  status: z.enum(["ACTIVO", "BAJA"]),
  hireDate: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/).optional(),
  endDate: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/).optional(),
  dailySalary: z.union([z.coerce.number().min(0).max(100000), z.literal("")]).optional(),
  clabe: z.string().trim().regex(/^(\d{18})?$/, "La CLABE son 18 dígitos").optional().transform((v) => v || null),
  bank: opt(60), phone: opt(20), email: z.string().trim().email("Correo inválido").optional().or(z.literal("")).transform((v) => v || null),
  entryTime: z.string().optional(), lunchMinutes: z.coerce.number().int().min(0).max(240), punchesPerDay: z.enum(["2", "4"]),
  motoType: opt(40), address: opt(300), notes: opt(1000),
});

function readForm(fd: FormData) {
  const p = schema.safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: p.error.issues[0].message } as const;
  const d = p.data;
  const workdays = fd.getAll("workdays").map(Number).filter((n) => n >= 1 && n <= 7);
  const entryTime = d.entryTime ? parseClock(d.entryTime) : null;
  if (d.entryTime && !entryTime) return { error: "Hora de entrada inválida" } as const;
  return {
    data: {
      ...d,
      rfc: d.rfc?.toUpperCase() ?? null, curp: d.curp?.toUpperCase() ?? null,
      hireDate: d.hireDate ? new Date(`${d.hireDate}T00:00:00Z`) : null,
      endDate: d.endDate ? new Date(`${d.endDate}T00:00:00Z`) : null,
      dailySalary: d.dailySalary === "" || d.dailySalary === undefined ? null : new Prisma.Decimal(d.dailySalary),
      entryTime, workdays, punchesPerDay: Number(d.punchesPerDay),
    },
  } as const;
}

export async function createEmployee(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser(["ADMIN"]);
  const r = readForm(fd);
  if ("error" in r) return { error: r.error };
  try {
    const e = await prisma.employee.create({ data: r.data });
    await audit(prisma, { actorUserId: user.id, action: "employee.created", entity: "Employee", entityId: e.id, summary: `Alta de ${e.name} (#${e.employeeNo})` });
    redirect(`/admin/personal/${e.id}`);
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { error: "Ese número de empleado ya existe" };
    throw e;
  }
}

export async function updateEmployee(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser(["ADMIN"]);
  const r = readForm(fd);
  if ("error" in r) return { error: r.error };
  try {
    const e = await prisma.employee.update({ where: { id }, data: r.data });
    await audit(prisma, { actorUserId: user.id, action: "employee.updated", entity: "Employee", entityId: id, summary: `Datos de ${e.name} actualizados` });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { error: "Ese número de empleado ya existe" };
    throw e;
  }
  revalidatePath(`/admin/personal/${id}`);
  return { ok: "Guardado" };
}

/** Liga a un usuario existente o crea su acceso al portal (rol empleado). */
export async function linkUserAction(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const admin = await requireUser(["ADMIN"]);
  const emp = await prisma.employee.findUniqueOrThrow({ where: { id } });
  const existing = String(fd.get("userId") ?? "");
  if (existing === "__none") {
    await prisma.employee.update({ where: { id }, data: { userId: null } });
    revalidatePath(`/admin/personal/${id}`);
    return { ok: "Acceso desligado" };
  }
  try {
    if (existing) {
      await prisma.employee.update({ where: { id }, data: { userId: existing } });
    } else {
      const username = String(fd.get("username") ?? "").trim().toLowerCase();
      const password = String(fd.get("password") ?? "");
      if (!/^[a-z0-9._-]{3,40}$/.test(username)) return { error: "Usuario: 3 a 40 letras, números, punto o guion" };
      if (password.length < 8) return { error: "La contraseña debe tener al menos 8 caracteres" };
      const u = await prisma.user.create({ data: { username, name: emp.name, role: "EMPLEADO", passwordHash: await hashPassword(password) } });
      await prisma.employee.update({ where: { id }, data: { userId: u.id } });
    }
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { error: "Ese usuario ya existe o ya está ligado a otro empleado" };
    throw e;
  }
  await audit(prisma, { actorUserId: admin.id, action: "employee.user_linked", entity: "Employee", entityId: id, summary: `Acceso a la plataforma para ${emp.name}` });
  revalidatePath(`/admin/personal/${id}`);
  return { ok: "Acceso listo" };
}

export async function importEmployeesAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser(["ADMIN"]);
  const p = parseEmployees(await formText(fd), { workdays: parseWorkdays, clock: parseClock });
  if (!p.rows.length) return { error: p.errors[0] ?? "No se encontraron empleados" };
  const r = await importEmployees(prisma, p.rows, user.id);
  revalidatePath("/admin/personal");
  return { ok: `${r.created} nuevo(s), ${r.updated} actualizado(s)${p.errors.length ? ` · ${p.errors.length} renglón(es) omitidos` : ""}` };
}

export async function importPunchesAction(_: ActionState, fd: FormData): Promise<ActionState> {
  await requireUser(["ADMIN"]);
  const text = await formText(fd);
  if (text.length > 20_000_000) return { error: "Demasiado grande; súbelo por meses" };
  const p = parsePunches(text, normalizePunchKind);
  if (!p.rows.length) return { error: p.errors[0] ?? "No se encontraron checadas" };
  const r = await importPunches(prisma, p.rows);
  revalidatePath("/admin/checador");
  const unk = r.unknownEmployees.length ? ` · sin empleado en Personal: ${r.unknownEmployees.slice(0, 15).join(", ")}${r.unknownEmployees.length > 15 ? "…" : ""}` : "";
  return { ok: `${r.added} checada(s) nuevas, ${r.duplicates} ya estaban${p.errors.length ? ` · ${p.errors.length} renglón(es) no se entendieron` : ""}${unk}` };
}
