import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { importMlAccounts, parseMlImport, planMlImport, prisma } from "./index.ts";

const n = 600000 + Number(String(Date.now()).slice(-5));
const s1 = String(BigInt(Date.now()) * 5n), s2 = String(BigInt(Date.now()) * 5n + 1n);
let actor: string, a: string, b: string;

beforeAll(async () => {
  actor = (await prisma.user.findFirstOrThrow({ where: { role: "ADMIN" } })).id;
  a = (await prisma.client.create({ data: { publicId: `cmx${n}`, name: "A", paymentReference: `CMX${n}`, tariffAmount: 50, branches: { create: { name: "Principal", address: "X" } } } })).id;
  b = (await prisma.client.create({ data: { publicId: `emx${n}`, name: "B", paymentReference: `EMX${n}`, tariffAmount: 50 } })).id;
});
afterAll(async () => {
  await prisma.mlAccount.deleteMany({ where: { clientId: { in: [a, b] } } });
  await prisma.branch.deleteMany({ where: { clientId: { in: [a, b] } } });
  await prisma.client.deleteMany({ where: { id: { in: [a, b] } } });
  await prisma.$disconnect();
});

describe("importar cuentas ML", () => {
  it("valida, crea con ruta a la sucursal y es re-ejecutable", async () => {
    const bad = parseMlImport(`Vendedor ML,Cuenta,ID cliente\n${s1},UNO,cmx${n}\n${s1},UNO,cmx${n}\nabc,X,cmx${n}\n${s2},DOS,cmx999999`);
    const plan = await planMlImport(prisma, bad.rows);
    expect(plan.map((p) => p.error ?? p.action)).toEqual(["nueva", "Repetido en el archivo", "Vendedor ML inválido", "No existe el cliente cmx999999"]);
    expect(await importMlAccounts(prisma, bad.rows, actor)).toMatchObject({ ok: false });

    const good = parseMlImport(`${s1}\tUNO\tCMX${n}\n${s2}\tDOS\temx${n}`);
    expect(await importMlAccounts(prisma, good.rows, actor)).toEqual({ ok: true, created: 2, moved: 0, unchanged: 0 });
    const acc1 = await prisma.mlAccount.findUniqueOrThrow({ where: { mlUserId: BigInt(s1) }, include: { routes: true } });
    expect(acc1.routes).toHaveLength(1);
    expect(acc1.routes[0].isDefault).toBe(true);

    const again = parseMlImport(`${s1},UNO,emx${n}\n${s2},DOS,emx${n}`);
    expect(await importMlAccounts(prisma, again.rows, actor)).toEqual({ ok: true, created: 0, moved: 1, unchanged: 1 });
    const moved = await prisma.mlAccount.findUniqueOrThrow({ where: { mlUserId: BigInt(s1) }, include: { routes: true } });
    expect(moved.clientId).toBe(b);
    expect(moved.routes).toHaveLength(0); // B no tiene sucursal todavía
  });
});
