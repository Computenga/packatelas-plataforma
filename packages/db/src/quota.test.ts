import "dotenv/config";
import { afterAll, expect, it } from "vitest";
import { addToQuota, prisma } from "./index.ts";

const key = `test-${Math.random()}`;
afterAll(async () => {
  await prisma.setting.deleteMany({ where: { key: `quota:${key}` } });
  await prisma.$disconnect();
});

it("suma el cupo de forma atómica aun con llamadas simultáneas", async () => {
  await Promise.all(Array.from({ length: 20 }, () => addToQuota(prisma, key, 5)));
  expect(await addToQuota(prisma, key, 0)).toBe(100);
});
