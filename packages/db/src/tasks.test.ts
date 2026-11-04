import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addTaskComment, createTask, dueFrom, getTaskFor, listTasks, prisma, taskAction, taskCounters, taskFileFor, taskReminders, toggleTaskStep, updateTask } from "./index.ts";

const tag = `tk${Date.now()}`;
let boss: string, worker: string, other: string, client: string;
const f = (n: string) => ({ key: `tasks/2026/11/${tag}-${n}.jpg`, fileName: `${n}.jpg`, mime: "image/jpeg", size: 10 });

beforeAll(async () => {
  const mk = (s: string, role: "ADMIN" | "EMPLEADO" | "REPARTIDOR" | "CLIENTE") => prisma.user.create({ data: { username: `${tag}_${s}`, name: `${s} ${tag}`, role, passwordHash: "x" } }).then((u) => u.id);
  [boss, worker, other, client] = await Promise.all([mk("jefe", "ADMIN"), mk("emp", "EMPLEADO"), mk("otro", "ADMIN"), mk("cli", "CLIENTE")]);
});
afterAll(async () => {
  const ids = [boss, worker, other, client];
  await prisma.task.deleteMany({ where: { OR: [{ createdById: { in: ids } }, { assigneeId: { in: ids } }] } });
  await prisma.appNotice.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
});

describe("tareas", () => {
  it("flujo completo: asignar, pasos, evidencia, revisión, regresar y aprobar; solo las dos personas la ven", async () => {
    await expect(createTask(prisma, boss, { title: "Hola", assigneeId: client })).rejects.toThrow(/a quién/);
    const t = await createTask(prisma, boss, { title: "Inventario de bodega", assigneeId: worker, dueAt: dueFrom("2026-11-06"), checklist: ["Contar cajas", "Foto del anaquel"] }, [f("guia")]);
    expect(t.status).toBe("PENDIENTE");
    expect(t.requiresApproval).toBe(true);

    expect(await getTaskFor(prisma, t.id, other)).toBeNull();
    expect((await listTasks(prisma, other)).some((x) => x.id === t.id)).toBe(false);
    expect(await taskFileFor(prisma, f("guia").key, other)).toBeNull();
    expect(await taskFileFor(prisma, f("guia").key, worker)).toMatchObject({ fileName: "guia.jpg" });
    expect((await listTasks(prisma, worker, { scope: "mine" })).map((x) => x.id)).toContain(t.id);
    expect((await listTasks(prisma, boss, { scope: "assigned" })).map((x) => x.id)).toContain(t.id);
    expect(await taskCounters(prisma, worker, new Date("2026-11-07T12:00:00Z"))).toMatchObject({ mine: 1, overdue: 1 });

    await expect(taskAction(prisma, t.id, boss, "start")).rejects.toThrow();
    await expect(updateTask(prisma, t.id, worker, { title: "Otra" })).rejects.toThrow(/Solo quien asignó/);
    const g = await getTaskFor(prisma, t.id, worker);
    await toggleTaskStep(prisma, t.id, worker, g!.checklist[0].id, true);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: t.id } })).status).toBe("EN_PROCESO");

    await expect(taskAction(prisma, t.id, worker, "submit", { note: "Listo", files: [f("ev1")] })).rejects.toThrow(/paso/);
    await toggleTaskStep(prisma, t.id, worker, g!.checklist[1].id, true);
    await expect(taskAction(prisma, t.id, worker, "submit", { note: "Listo" })).rejects.toThrow(/evidencia/);
    expect(await taskAction(prisma, t.id, worker, "submit", { note: "Conté 40 cajas", files: [f("ev1")] })).toEqual({ status: "EN_REVISION" });

    await expect(taskAction(prisma, t.id, boss, "return")).rejects.toThrow(/qué falta/);
    expect(await taskAction(prisma, t.id, boss, "return", { note: "Falta la foto del anaquel 3" })).toEqual({ status: "EN_PROCESO" });
    await addTaskComment(prisma, t.id, worker, "Va la foto", [f("ev2")]);
    expect(await taskAction(prisma, t.id, worker, "submit", { note: "Ya con la foto", files: [f("ev3")] })).toEqual({ status: "EN_REVISION" });
    expect(await taskAction(prisma, t.id, boss, "approve")).toEqual({ status: "COMPLETADA" });

    const done = await getTaskFor(prisma, t.id, boss);
    expect(done!.files.filter((x) => x.evidence).length).toBe(2);
    expect(done!.events.map((e) => e.kind)).toEqual(["created", "checklist", "checklist", "evidence", "status", "comment", "evidence", "status"]);
    // Aviso al empleado con liga a su portal.
    expect(await prisma.appNotice.findFirst({ where: { userId: worker, url: `/empleado/tareas/${t.id}` } })).toBeTruthy();
  });

  it("tarea propia: se cierra sin revisión; edición conserva pasos hechos; recordatorios una sola vez", async () => {
    const t = await createTask(prisma, boss, { title: "Llamar al contador", assigneeId: boss, requiresEvidence: false, checklist: ["Llamar"] });
    expect(t.requiresApproval).toBe(false);
    const g = await getTaskFor(prisma, t.id, boss);
    await toggleTaskStep(prisma, t.id, boss, g!.checklist[0].id, true);
    await updateTask(prisma, t.id, boss, { checklist: ["Llamar", "Mandar facturas"] });
    const g2 = await getTaskFor(prisma, t.id, boss);
    expect(g2!.checklist.map((s) => [s.text, s.done])).toEqual([["Llamar", true], ["Mandar facturas", false]]);

    const late = await createTask(prisma, boss, { title: "Vencida", assigneeId: worker, dueAt: new Date(Date.now() - 3600_000) });
    const r1 = await taskReminders(prisma);
    expect(r1.late).toBeGreaterThanOrEqual(1);
    const again = await taskReminders(prisma);
    expect(await prisma.task.findUniqueOrThrow({ where: { id: late.id } })).toMatchObject({ overdueSentAt: expect.any(Date) });
    expect(again.late).toBe(0);
    await expect(taskAction(prisma, t.id, boss, "submit", {})).rejects.toThrow(/paso/);
    await toggleTaskStep(prisma, t.id, boss, g2!.checklist[1].id, true);
    await taskAction(prisma, t.id, boss, "submit", {});
    expect((await prisma.task.findUniqueOrThrow({ where: { id: t.id } })).status).toBe("COMPLETADA");
    await taskAction(prisma, late.id, boss, "cancel");
    await expect(taskAction(prisma, late.id, worker, "start")).rejects.toThrow();
  });
});
