import "dotenv/config";
import { afterAll, describe, expect, it } from "vitest";
import { alertNotVisited, isNotVisited, prisma } from "./index.ts";

const ship = BigInt(`77${String(Date.now()).slice(-9)}`);
afterAll(async () => {
  await prisma.appNotice.deleteMany({ where: { body: { contains: ship.toString() } } });
  const row = await prisma.setting.findUnique({ where: { key: "falta.not_visited" } });
  if (row) await prisma.setting.update({ where: { key: "falta.not_visited" }, data: { value: ((row.value as string[]) ?? []).filter((x) => x !== ship.toString()) } });
  await prisma.$disconnect();
});

describe("falta grave «no visitado»", () => {
  it("detecta el estado y avisa una sola vez", async () => {
    expect(isNotVisited("not_delivered", "not_visited")).toBe(true);
    expect(isNotVisited("NOT_VISITED", null)).toBe(true);
    expect(isNotVisited("not_delivered", "receiver_absent")).toBe(false);
    const admins = await prisma.user.count({ where: { role: "ADMIN", active: true } });
    expect(await alertNotVisited(prisma, ship)).toBe(true);
    expect(await alertNotVisited(prisma, ship)).toBe(false);
    expect(await prisma.appNotice.count({ where: { body: { contains: ship.toString() } } })).toBe(admins);
  });
});
