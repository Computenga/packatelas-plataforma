// Altas por enlace y expedientes [A22, A25]. La persona abre /alta, llena sus datos y sube sus
// documentos; RH los revisa (aprobar / rechazar con comentario) y al aprobar se crea el empleado
// con su expediente. Los documentos de empleados existentes los sube RH o el propio empleado.
import { createHash, randomBytes } from "node:crypto";
import { Prisma, type PrismaClient, type DocStatus } from "../generated/prisma/client.ts";
import { audit } from "./orders.ts";

type Db = PrismaClient | Prisma.TransactionClient;
const hash = (t: string) => createHash("sha256").update(t).digest("hex");

import { HIRE_ROLES } from "./onboarding-roles.ts";
export { HIRE_ROLES };
const appliesTo = (positions: string, role: string) => positions === "todos" || positions.split(",").map((s) => s.trim()).includes(role);

export async function docTypesFor(db: Db, role: string) {
  return (await db.docType.findMany({ where: { active: true }, orderBy: { order: "asc" } })).filter((d) => appliesTo(d.positions, role));
}
export async function appsFor(db: Db, role: string) {
  return (await db.onboardingApp.findMany({ where: { active: true }, orderBy: { order: "asc" } })).filter((a) => appliesTo(a.positions, role));
}

export async function createApplication(prisma: PrismaClient, role: string) {
  const token = randomBytes(24).toString("base64url");
  const app = await prisma.hireApplication.create({ data: { tokenHash: hash(token), role: HIRE_ROLES[role] ? role : "otro" } });
  return { id: app.id, token };
}

export const findApplication = (db: Db, token: string) =>
  /^[\w-]{20,64}$/.test(token) ? db.hireApplication.findUnique({ where: { tokenHash: hash(token) }, include: { documents: { orderBy: { uploadedAt: "desc" } } } }) : Promise.resolve(null);

/** Último documento de cada tipo (el que cuenta). */
export function latestByType<T extends { docType: string; uploadedAt: Date }>(docs: T[]): Map<string, T> {
  const m = new Map<string, T>();
  for (const d of [...docs].sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime())) if (!m.has(d.docType)) m.set(d.docType, d);
  return m;
}

export async function addDocument(
  prisma: PrismaClient,
  d: { applicationId?: string; employeeId?: string; docType: string; fileKey: string; fileName?: string; mime: string },
  actorUserId?: string,
) {
  if (!d.applicationId && !d.employeeId) throw new Error("Falta a quién pertenece");
  if (!(await prisma.docType.findUnique({ where: { key: d.docType } }))) throw new Error("Tipo de documento inválido");
  // Un documento nuevo del mismo tipo reemplaza al pendiente o rechazado (el aprobado se queda en historial).
  await prisma.employeeDocument.deleteMany({
    where: { docType: d.docType, status: { not: "APROBADO" }, ...(d.applicationId ? { applicationId: d.applicationId } : { employeeId: d.employeeId }) },
  });
  const doc = await prisma.employeeDocument.create({ data: { ...d, fileName: d.fileName?.slice(0, 120) } });
  if (actorUserId) await audit(prisma, { actorUserId, action: "employee.document_uploaded", entity: "EmployeeDocument", entityId: doc.id, summary: `Documento ${d.docType} subido` });
  return doc;
}

export async function reviewDocument(prisma: PrismaClient, docId: string, status: Exclude<DocStatus, "PENDIENTE">, comment: string | null, actorUserId: string) {
  if (status === "RECHAZADO" && !comment?.trim()) throw new Error("Escribe por qué se rechaza para que lo corrija");
  const d = await prisma.employeeDocument.update({ where: { id: docId }, data: { status, comment: comment?.slice(0, 300) || null, reviewedById: actorUserId, reviewedAt: new Date() } });
  await audit(prisma, { actorUserId, action: "employee.document_reviewed", entity: "EmployeeDocument", entityId: docId, summary: `Documento ${d.docType} ${status === "APROBADO" ? "aprobado" : "rechazado"}` });
  return d;
}

export type ApplicationData = Partial<Pick<Prisma.HireApplicationUpdateInput,
  "name" | "rfc" | "curp" | "nss" | "phone" | "email" | "address" | "clabe" | "bank" | "emergencyName" | "emergencyPhone" | "emergencyRelation">>;

/** Lo que falta para poder enviar la solicitud. */
export async function missingForSubmit(db: Db, appId: string) {
  const a = await db.hireApplication.findUniqueOrThrow({ where: { id: appId }, include: { documents: true } });
  const missing: string[] = [];
  if (!a.name || a.name.length < 5) missing.push("Nombre completo");
  if (!a.phone) missing.push("Teléfono");
  if (!a.curp) missing.push("CURP");
  const have = latestByType(a.documents);
  for (const t of await docTypesFor(db, a.role)) {
    if (!t.required) continue;
    const d = have.get(t.key);
    if (!d) missing.push(t.name);
    else if (d.status === "RECHAZADO") missing.push(`${t.name} (rechazado: vuelve a subirlo)`);
  }
  return missing;
}

export async function submitApplication(prisma: PrismaClient, appId: string) {
  const missing = await missingForSubmit(prisma, appId);
  if (missing.length) return { ok: false as const, missing };
  await prisma.hireApplication.update({ where: { id: appId }, data: { status: "ENVIADA", submittedAt: new Date() } });
  return { ok: true as const };
}

/** Aprueba la solicitud: crea el empleado con su número del ZKTeco y le pasa los documentos. */
export async function approveApplication(prisma: PrismaClient, appId: string, input: { employeeNo: number; entryTime?: string }, actorUserId: string) {
  if (!Number.isInteger(input.employeeNo) || input.employeeNo < 1) return { ok: false as const, error: "Número de empleado inválido" };
  return prisma.$transaction(async (tx) => {
    const a = await tx.hireApplication.findUnique({ where: { id: appId }, include: { documents: true } });
    if (!a) return { ok: false as const, error: "Solicitud no encontrada" };
    if (a.status === "APROBADA") return { ok: false as const, error: "Ya se aprobó" };
    if (!a.name) return { ok: false as const, error: "La solicitud no tiene nombre" };
    if (await tx.employee.findUnique({ where: { employeeNo: input.employeeNo } })) return { ok: false as const, error: `El número ${input.employeeNo} ya es de otro empleado` };
    const pending = [...latestByType(a.documents).values()].filter((d) => d.status !== "APROBADO");
    if (pending.length) return { ok: false as const, error: `Faltan por aprobar: ${pending.map((d) => d.docType).join(", ")}` };
    const emp = await tx.employee.create({
      data: {
        employeeNo: input.employeeNo, name: a.name, rfc: a.rfc?.toUpperCase(), curp: a.curp?.toUpperCase(), nss: a.nss, phone: a.phone, email: a.email,
        address: a.address, clabe: a.clabe, bank: a.bank, kind: a.role, hireDate: new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`),
        entryTime: input.entryTime ?? null,
        emergency: a.emergencyName ? { name: a.emergencyName, phone: a.emergencyPhone, relation: a.emergencyRelation } : undefined,
      },
    });
    await tx.employeeDocument.updateMany({ where: { applicationId: a.id }, data: { employeeId: emp.id } });
    await tx.hireApplication.update({ where: { id: a.id }, data: { status: "APROBADA", employeeId: emp.id, resolvedById: actorUserId, resolvedAt: new Date() } });
    await audit(tx, { actorUserId, action: "employee.hired", entity: "Employee", entityId: emp.id, summary: `Alta de ${emp.name} (#${emp.employeeNo}) desde solicitud` });
    return { ok: true as const, employeeId: emp.id };
  });
}

export async function rejectApplication(prisma: PrismaClient, appId: string, note: string, actorUserId: string) {
  await prisma.hireApplication.update({ where: { id: appId }, data: { status: "RECHAZADA", notes: note.slice(0, 500), resolvedById: actorUserId, resolvedAt: new Date() } });
  await audit(prisma, { actorUserId, action: "employee.application_rejected", entity: "HireApplication", entityId: appId, summary: `Solicitud rechazada: ${note}` });
}

/** Estado del expediente de un empleado: cada tipo de documento con su último archivo. */
export async function employeeFile(db: Db, employeeId: string) {
  const e = await db.employee.findUniqueOrThrow({ where: { id: employeeId }, select: { kind: true } });
  const [types, docs] = await Promise.all([docTypesFor(db, e.kind ?? "otro"), db.employeeDocument.findMany({ where: { employeeId } })]);
  const latest = latestByType(docs);
  const extra = [...latest.keys()].filter((k) => !types.some((t) => t.key === k));
  const allTypes = [...types, ...(await db.docType.findMany({ where: { key: { in: extra } } }))];
  return allTypes.map((t) => ({ type: t, doc: latest.get(t.key) ?? null }));
}
