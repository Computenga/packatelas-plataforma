import "dotenv/config";
import { afterAll, describe, expect, it } from "vitest";
import { prisma, syncAlerts, type Alert } from "./index.ts";

const checker = `test-${Math.random().toString(36).slice(2)}`;
afterAll(async () => {
  await prisma.setting.deleteMany({ where: { key: `alerts.${checker}` } });
  await prisma.$disconnect();
});

describe("alertas", () => {
  const sent: string[] = [];
  const send = (async (_db: unknown, _ids: string[], m: { title: string; body: string }) => { sent.push(`${m.title}|${m.body}`); return { sent: 1, removed: 0 }; }) as never;
  const t = (min: number) => new Date(Date.UTC(2026, 9, 27, 12, min));
  const gmail: Alert = { key: "gmail", title: "Gmail", body: "falla" };

  it("avisa tras dos revisiones seguidas, no repite y avisa al resolverse", async () => {
    expect(await syncAlerts(prisma, [gmail], checker, send, t(0))).toEqual([]);
    expect(await syncAlerts(prisma, [gmail], checker, send, t(5))).toEqual(["gmail"]);
    expect(await syncAlerts(prisma, [gmail], checker, send, t(10))).toEqual([]);
    expect(await syncAlerts(prisma, [], checker, send, t(15))).toEqual(["gmail:ok"]);
    expect(sent).toEqual(["Gmail|falla", "Resuelto|Ya está bien: lectura de depósitos en Gmail"]);
  });

  it("un problema de una sola revisión no avisa; pagos nuevos sí y al aumentar", async () => {
    sent.length = 0;
    await syncAlerts(prisma, [gmail], checker, send, t(20));
    await syncAlerts(prisma, [], checker, send, t(25));
    expect(sent).toEqual([]);
    const pagos = (n: number): Alert => ({ key: "pagos", title: "Pagos", body: `${n}`, value: n });
    expect(await syncAlerts(prisma, [pagos(1)], checker, send, t(30))).toEqual(["pagos"]);
    expect(await syncAlerts(prisma, [pagos(1)], checker, send, t(35))).toEqual([]);
    expect(await syncAlerts(prisma, [pagos(2)], checker, send, t(40))).toEqual(["pagos"]);
    expect(await syncAlerts(prisma, [], checker, send, t(45))).toEqual([]); // asignados: sin "resuelto"
  });
});
