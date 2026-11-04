// Tareas tipo Asana [A40]. Cualquiera del equipo (no clientes) asigna un pendiente a otra persona o a sí
// mismo, con fecha objetivo, prioridad, lista de pasos, archivos y comentarios.
// Flujo: PENDIENTE → EN_PROCESO → (al terminar, con evidencia) EN_REVISION → COMPLETADA.
// Si no pide revisión, o es una tarea propia, al terminar queda COMPLETADA directo.
// Visibilidad: SOLO quien la asignó y quien la tiene (ni otros administradores).
import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient, Role, TaskPriority, TaskStatus } from "../generated/prisma/client.ts";
import { sendPush } from "./push.ts";

type Db = PrismaClient;
export type TaskFileInput = { key: string; fileName: string; mime: string; size: number };
export type ChecklistItem = { id: string; text: string; done: boolean; doneAt?: string };

export const taskFolio = (n: number) => `TA-${String(n).padStart(5, "0")}`;
export const TASK_STATUS: Record<TaskStatus, [string, "gray" | "blue" | "amber" | "green" | "red"]> = {
  PENDIENTE: ["Pendiente", "gray"],
  EN_PROCESO: ["En proceso", "blue"],
  EN_REVISION: ["Por revisar", "amber"],
  COMPLETADA: ["Completada", "green"],
  CANCELADA: ["Cancelada", "red"],
};
export const TASK_PRIORITY: Record<TaskPriority, [string, "gray" | "blue" | "amber" | "red"]> = {
  BAJA: ["Baja", "gray"],
  NORMAL: ["Normal", "blue"],
  ALTA: ["Alta", "amber"],
  URGENTE: ["Urgente", "red"],
};
const OPEN: TaskStatus[] = ["PENDIENTE", "EN_PROCESO", "EN_REVISION"];

/** Ruta de Tareas dentro del portal de cada rol. */
export function tasksPathFor(role: Role) {
  return role === "EMPLEADO" ? "/empleado/tareas" : role === "REPARTIDOR" ? "/repartidor/tareas" : role === "MECANICO" ? "/mecanico/tareas" : role === "CLIENTE" ? null : "/admin/tareas";
}

/** A quién se le puede asignar: usuarios activos del equipo (sin clientes). */
export function assignableUsers(prisma: Db) {
  return prisma.user.findMany({
    where: { active: true, role: { not: "CLIENTE" } },
    select: { id: true, name: true, role: true, employee: { select: { employeeNo: true, position: true } } },
    orderBy: { name: "asc" },
  });
}

const visible = (userId: string): Prisma.TaskWhereInput => ({ OR: [{ createdById: userId }, { assigneeId: userId }] });

async function notify(prisma: Db, toUserId: string, actorId: string | null, task: { id: string; number: number; title: string }, title: string, body?: string) {
  if (toUserId === actorId) return;
  const u = await prisma.user.findUnique({ where: { id: toUserId }, select: { role: true, active: true } });
  const base = u?.active ? tasksPathFor(u.role) : null;
  if (!base) return;
  await sendPush(prisma, [toUserId], { title: `${title} · ${taskFolio(task.number)}`, body: (body ?? task.title).slice(0, 180), url: `${base}/${task.id}` }).catch(() => {});
}

function cleanChecklist(raw: unknown, prev: ChecklistItem[] = []): ChecklistItem[] {
  const list = Array.isArray(raw) ? raw : [];
  const byId = new Map(prev.map((i) => [i.id, i]));
  return list
    .map((x) => (typeof x === "string" ? { text: x } : (x as Partial<ChecklistItem>)))
    .map((x) => ({ id: x.id && byId.has(x.id) ? x.id : randomUUID().slice(0, 8), text: String(x.text ?? "").trim().slice(0, 200), done: x.id ? (byId.get(x.id)?.done ?? false) : false, doneAt: x.id ? byId.get(x.id)?.doneAt : undefined }))
    .filter((x) => x.text)
    .slice(0, 30);
}

export type TaskInput = {
  title: string; description?: string; assigneeId: string; priority?: TaskPriority; dueAt?: Date | null;
  requiresEvidence?: boolean; requiresApproval?: boolean; checklist?: string[];
};

function validate(input: Partial<TaskInput>) {
  if (input.title !== undefined && input.title.trim().length < 3) throw new Error("Escribe qué hay que hacer (mínimo 3 letras)");
  if (input.dueAt && Number.isNaN(input.dueAt.getTime())) throw new Error("Fecha objetivo inválida");
}

export async function createTask(prisma: Db, actorId: string, input: TaskInput, files: TaskFileInput[] = []) {
  validate(input);
  const assignee = await prisma.user.findFirst({ where: { id: input.assigneeId, active: true, role: { not: "CLIENTE" } }, select: { id: true } });
  if (!assignee) throw new Error("Elige a quién se la asignas");
  const self = input.assigneeId === actorId;
  const task = await prisma.task.create({
    data: {
      title: input.title.trim().slice(0, 200), description: input.description?.trim().slice(0, 5000) || null,
      createdById: actorId, assigneeId: input.assigneeId, priority: input.priority ?? "NORMAL", dueAt: input.dueAt ?? null,
      requiresEvidence: input.requiresEvidence ?? true, requiresApproval: self ? false : (input.requiresApproval ?? true),
      checklist: cleanChecklist(input.checklist ?? []) as unknown as Prisma.InputJsonValue,
      events: { create: { authorId: actorId, kind: "created", toStatus: "PENDIENTE" } },
    },
  });
  if (files.length) await attach(prisma, task.id, actorId, null, files, false);
  await notify(prisma, input.assigneeId, actorId, task, "Nueva tarea para ti", `${task.title}${task.dueAt ? ` · para el ${fmtDue(task.dueAt)}` : ""}`);
  return task;
}

async function attach(prisma: Db, taskId: string, actorId: string, eventId: string | null, files: TaskFileInput[], evidence: boolean) {
  if (!files.length) return;
  await prisma.taskFile.createMany({
    data: files.slice(0, 10).map((f) => ({ taskId, eventId, uploadedById: actorId, key: f.key, fileName: f.fileName.slice(0, 200), mime: f.mime, size: f.size, evidence })),
  });
}

/** «jue 6 nov» o «jue 6 nov, 10:00» (las 23:59 se leen como «en el día»). */
export const fmtDue = (d: Date) => {
  const tz = "America/Mexico_City";
  const hm = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
  const day = new Intl.DateTimeFormat("es-MX", { timeZone: tz, weekday: "short", day: "numeric", month: "short" }).format(d);
  return hm === "23:59" ? day : `${day}, ${hm}`;
};

/** Fecha objetivo desde el formulario: día (AAAA-MM-DD) y hora opcional (HH:MM), hora de CDMX. */
export function dueFrom(ymd: string, hm?: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const t = /^\d{2}:\d{2}$/.test(hm ?? "") ? hm! : "23:59";
  return new Date(`${ymd}T${t}:00-06:00`);
}

export type TaskScope = "mine" | "assigned" | "all";

export async function listTasks(prisma: Db, userId: string, opts: { scope?: TaskScope; open?: boolean; status?: TaskStatus; q?: string } = {}) {
  const scope = opts.scope ?? "all";
  const who: Prisma.TaskWhereInput = scope === "mine" ? { assigneeId: userId } : scope === "assigned" ? { createdById: userId, NOT: { assigneeId: userId } } : visible(userId);
  const q = opts.q?.trim();
  return prisma.task.findMany({
    where: {
      AND: [
        who,
        opts.status ? { status: opts.status } : opts.open === false ? { status: { in: ["COMPLETADA", "CANCELADA"] } } : opts.open ? { status: { in: OPEN } } : {},
        q ? { OR: [{ title: { contains: q, mode: "insensitive" } }, { description: { contains: q, mode: "insensitive" } }, ...(/^\D*\d+$/.test(q) ? [{ number: Number(q.replace(/\D/g, "")) }] : [])] } : {},
      ],
    },
    include: { createdBy: { select: { id: true, name: true } }, assignee: { select: { id: true, name: true } }, _count: { select: { files: true, events: { where: { kind: "comment" } } } } },
    orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
    take: 300,
  });
}

/** Contadores para el menú/inicio: abiertas a mi nombre, vencidas y por revisar (de las que asigné). */
export async function taskCounters(prisma: Db, userId: string, now = new Date()) {
  const [mine, overdue, toReview] = await Promise.all([
    prisma.task.count({ where: { assigneeId: userId, status: { in: ["PENDIENTE", "EN_PROCESO"] } } }),
    prisma.task.count({ where: { assigneeId: userId, status: { in: ["PENDIENTE", "EN_PROCESO"] }, dueAt: { lt: now } } }),
    prisma.task.count({ where: { createdById: userId, status: "EN_REVISION", NOT: { assigneeId: userId } } }),
  ]);
  return { mine, overdue, toReview };
}

/** La tarea con su historial, o null si esta persona no la puede ver. */
export async function getTaskFor(prisma: Db, id: string, userId: string) {
  const t = await prisma.task.findFirst({
    where: { id, ...visible(userId) },
    include: {
      createdBy: { select: { id: true, name: true } },
      assignee: { select: { id: true, name: true } },
      events: { orderBy: { createdAt: "asc" }, include: { author: { select: { id: true, name: true } }, files: true } },
      files: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!t) return null;
  return { ...t, checklist: (t.checklist as unknown as ChecklistItem[]) ?? [], isCreator: t.createdById === userId, isAssignee: t.assigneeId === userId };
}

async function load(prisma: Db, id: string, userId: string) {
  const t = await prisma.task.findFirst({ where: { id, ...visible(userId) } });
  if (!t) throw new Error("No encontramos esa tarea");
  return t;
}

/** Quien la asignó cambia datos: título, detalle, a quién, fecha, prioridad, requisitos y pasos. */
export async function updateTask(prisma: Db, id: string, actorId: string, patch: Partial<TaskInput>) {
  const t = await load(prisma, id, actorId);
  if (t.createdById !== actorId) throw new Error("Solo quien asignó la tarea puede editarla");
  validate(patch);
  if (patch.assigneeId && patch.assigneeId !== t.assigneeId) {
    const ok = await prisma.user.findFirst({ where: { id: patch.assigneeId, active: true, role: { not: "CLIENTE" } }, select: { id: true } });
    if (!ok) throw new Error("Elige a quién se la asignas");
  }
  const assigneeId = patch.assigneeId ?? t.assigneeId;
  const changes: string[] = [];
  if (patch.title !== undefined && patch.title.trim() !== t.title) changes.push("título");
  if (patch.description !== undefined && (patch.description.trim() || null) !== t.description) changes.push("detalle");
  if (patch.dueAt !== undefined && (patch.dueAt?.getTime() ?? null) !== (t.dueAt?.getTime() ?? null)) changes.push(patch.dueAt ? `fecha objetivo: ${fmtDue(patch.dueAt)}` : "sin fecha objetivo");
  if (patch.priority && patch.priority !== t.priority) changes.push(`prioridad: ${TASK_PRIORITY[patch.priority][0]}`);
  if (assigneeId !== t.assigneeId) changes.push("persona asignada");
  // Pasos editados: los que conservan el mismo texto conservan si ya estaban hechos.
  const prevSteps = (t.checklist as unknown as ChecklistItem[]) ?? [];
  const checklist = patch.checklist
    ? cleanChecklist(patch.checklist.map((text) => prevSteps.find((p) => p.text === text.trim()) ?? { text }), prevSteps)
    : undefined;
  if (checklist) changes.push("pasos");
  const updated = await prisma.task.update({
    where: { id },
    data: {
      ...(patch.title !== undefined ? { title: patch.title.trim().slice(0, 200) } : {}),
      ...(patch.description !== undefined ? { description: patch.description.trim().slice(0, 5000) || null } : {}),
      ...(patch.priority ? { priority: patch.priority } : {}),
      ...(patch.dueAt !== undefined ? { dueAt: patch.dueAt, dueSoonSentAt: null, overdueSentAt: null } : {}),
      ...(patch.requiresEvidence !== undefined ? { requiresEvidence: patch.requiresEvidence } : {}),
      ...(patch.requiresApproval !== undefined ? { requiresApproval: assigneeId === actorId ? false : patch.requiresApproval } : {}),
      ...(checklist ? { checklist: checklist as unknown as Prisma.InputJsonValue } : {}),
      assigneeId,
      ...(changes.length ? { events: { create: { authorId: actorId, kind: "edit", body: `Cambió ${changes.join(", ")}` } } } : {}),
    },
  });
  if (assigneeId !== t.assigneeId) await notify(prisma, assigneeId, actorId, updated, "Te asignaron una tarea");
  else if (changes.length) await notify(prisma, assigneeId, actorId, updated, "Cambió una tarea", `Cambió ${changes.join(", ")}`);
  return updated;
}

export type TaskAction = "start" | "submit" | "approve" | "return" | "cancel" | "reopen";

/** Cambios de estatus. `submit` es «terminé» (con evidencia si la pide). `return` la regresa con un motivo. */
export async function taskAction(prisma: Db, id: string, actorId: string, action: TaskAction, opts: { note?: string; files?: TaskFileInput[] } = {}) {
  const t = await load(prisma, id, actorId);
  const note = opts.note?.trim().slice(0, 3000) || null;
  const files = opts.files ?? [];
  const creator = t.createdById === actorId, assignee = t.assigneeId === actorId;
  let to: TaskStatus;
  const now = new Date();
  const data: Prisma.TaskUpdateInput = {};
  switch (action) {
    case "start":
      if (!assignee) throw new Error("Solo quien tiene la tarea puede empezarla");
      if (t.status !== "PENDIENTE") throw new Error("La tarea ya no está pendiente");
      to = "EN_PROCESO"; data.startedAt = now;
      break;
    case "submit": {
      if (!assignee) throw new Error("Solo quien tiene la tarea puede marcarla como terminada");
      if (!["PENDIENTE", "EN_PROCESO"].includes(t.status)) throw new Error("La tarea no está abierta");
      if (t.requiresEvidence && (!note || note.length < 3 || !files.length)) throw new Error("Esta tarea pide evidencia: escribe qué hiciste y adjunta al menos un archivo o foto");
      const steps = (t.checklist as unknown as ChecklistItem[]) ?? [];
      const missing = steps.filter((s) => !s.done).length;
      if (missing) throw new Error(`Faltan ${missing} paso(s) de la lista por marcar`);
      const direct = !t.requiresApproval || t.createdById === t.assigneeId;
      to = direct ? "COMPLETADA" : "EN_REVISION";
      data.submittedAt = now; data.startedAt = t.startedAt ?? now;
      if (direct) data.completedAt = now;
      break;
    }
    case "approve":
      if (!creator) throw new Error("Solo quien asignó la tarea puede darle el visto bueno");
      if (t.status !== "EN_REVISION") throw new Error("La tarea no está por revisar");
      to = "COMPLETADA"; data.completedAt = now;
      break;
    case "return":
      if (!creator) throw new Error("Solo quien asignó la tarea puede regresarla");
      if (t.status !== "EN_REVISION") throw new Error("La tarea no está por revisar");
      if (!note || note.length < 3) throw new Error("Escribe qué falta o qué hay que corregir");
      to = "EN_PROCESO"; data.submittedAt = null;
      break;
    case "cancel":
      if (!creator) throw new Error("Solo quien asignó la tarea puede cancelarla");
      if (!OPEN.includes(t.status)) throw new Error("La tarea ya está cerrada");
      to = "CANCELADA"; data.cancelledAt = now;
      break;
    case "reopen":
      if (!creator) throw new Error("Solo quien asignó la tarea puede reabrirla");
      if (OPEN.includes(t.status)) throw new Error("La tarea sigue abierta");
      to = "EN_PROCESO"; data.completedAt = null; data.cancelledAt = null; data.submittedAt = null;
      break;
  }
  const claimed = await prisma.task.updateMany({ where: { id, status: t.status }, data: { ...(data as Prisma.TaskUpdateManyMutationInput), status: to } });
  if (!claimed.count) throw new Error("Alguien más la acaba de cambiar; recarga la página");
  const ev = await prisma.taskEvent.create({ data: { taskId: id, authorId: actorId, kind: action === "submit" ? "evidence" : "status", body: note, fromStatus: t.status, toStatus: to } });
  await attach(prisma, id, actorId, ev.id, files, action === "submit");

  const label = TASK_STATUS[to][0];
  const other = assignee ? t.createdById : t.assigneeId;
  const titles: Record<TaskAction, string> = {
    start: "Empezaron tu tarea", submit: to === "EN_REVISION" ? "Tarea terminada: revísala" : "Tarea completada", approve: "Tarea aprobada ✅",
    return: "Te regresaron una tarea", cancel: "Tarea cancelada", reopen: "Tarea reabierta",
  };
  await notify(prisma, other, actorId, t, titles[action], note ? `${t.title}: ${note}` : `${t.title} · ${label}`);
  return { status: to };
}

/** Comentario con archivos (cualquiera de los dos). */
export async function addTaskComment(prisma: Db, id: string, actorId: string, body: string, files: TaskFileInput[] = []) {
  const t = await load(prisma, id, actorId);
  const text = body.trim().slice(0, 3000);
  if (!text && !files.length) throw new Error("Escribe un comentario o adjunta un archivo");
  const ev = await prisma.taskEvent.create({ data: { taskId: id, authorId: actorId, kind: "comment", body: text || null } });
  await attach(prisma, id, actorId, ev.id, files, false);
  await prisma.task.update({ where: { id }, data: { updatedAt: new Date() } });
  const other = actorId === t.assigneeId ? t.createdById : t.assigneeId;
  await notify(prisma, other, actorId, t, "Comentario en una tarea", text || `${files.length} archivo(s) nuevo(s)`);
  return ev;
}

/** Marca/desmarca un paso de la lista (los dos pueden; queda en el historial). */
export async function toggleTaskStep(prisma: Db, id: string, actorId: string, stepId: string, done: boolean) {
  const t = await load(prisma, id, actorId);
  if (!OPEN.includes(t.status)) throw new Error("La tarea está cerrada");
  const list = ((t.checklist as unknown as ChecklistItem[]) ?? []).map((s) => (s.id === stepId ? { ...s, done, doneAt: done ? new Date().toISOString() : undefined } : s));
  const step = list.find((s) => s.id === stepId);
  if (!step) throw new Error("Ese paso ya no existe");
  await prisma.task.update({
    where: { id },
    data: {
      checklist: list as unknown as Prisma.InputJsonValue,
      ...(t.status === "PENDIENTE" && actorId === t.assigneeId && done ? { status: "EN_PROCESO", startedAt: new Date() } : {}),
      events: { create: { authorId: actorId, kind: "checklist", body: `${done ? "Marcó" : "Desmarcó"} «${step.text}»` } },
    },
  });
  return list;
}

/** ¿Esta persona puede ver este archivo? (solo las dos personas de la tarea). */
export async function taskFileFor(prisma: Db, key: string, userId: string) {
  return prisma.taskFile.findFirst({ where: { key, task: visible(userId) }, select: { fileName: true, mime: true } });
}

/** Avisos automáticos: vence en menos de 24 h (a quien la tiene) y venció (a los dos). Una vez cada uno. */
export async function taskReminders(prisma: Db, now = new Date()) {
  const soon = await prisma.task.findMany({
    where: { status: { in: ["PENDIENTE", "EN_PROCESO"] }, dueAt: { gt: now, lt: new Date(now.getTime() + 24 * 3600_000) }, dueSoonSentAt: null },
    take: 200,
  });
  for (const t of soon) {
    await prisma.task.update({ where: { id: t.id }, data: { dueSoonSentAt: now } });
    await notify(prisma, t.assigneeId, null, t, "Tarea por vencer ⏰", `${t.title} · ${fmtDue(t.dueAt!)}`);
  }
  const late = await prisma.task.findMany({ where: { status: { in: ["PENDIENTE", "EN_PROCESO"] }, dueAt: { lt: now }, overdueSentAt: null }, take: 200 });
  for (const t of late) {
    await prisma.task.update({ where: { id: t.id }, data: { overdueSentAt: now } });
    await notify(prisma, t.assigneeId, null, t, "Tarea vencida ⚠️", `${t.title} venció el ${fmtDue(t.dueAt!)}`);
    if (t.createdById !== t.assigneeId) await notify(prisma, t.createdById, null, t, "Una tarea que asignaste venció", t.title);
  }
  return { soon: soon.length, late: late.length };
}
