import "dotenv/config";
import { afterAll, describe, expect, it } from "vitest";
import { admsContact, admsReceiveAttlog, getAdmsConfig, parseAttlog, prisma, setAdmsConfig } from "./index.ts";

const no = 900000 + Math.floor(Math.random() * 9999);
afterAll(async () => {
  await prisma.punch.deleteMany({ where: { employee: { employeeNo: no } } });
  await prisma.employee.deleteMany({ where: { employeeNo: no } });
  await prisma.setting.deleteMany({ where: { key: "checador.adms" } });
  await prisma.$disconnect();
});

describe("ZKTeco ADMS", () => {
  it("interpreta ATTLOG en hora de CDMX y descarta renglones inválidos", () => {
    const { rows, skipped } = parseAttlog("15\t2026-10-26 09:58:12\t0\t1\t0\t0\nbasura\n15\t2026-10-26 18:01:00\t1\t15\t0", "SN1");
    expect(skipped).toBe(1);
    expect(rows[0]).toMatchObject({ employeeNo: 15, kind: "entrada", method: "huella", device: "ZKTeco SN1" });
    expect(rows[0].at.toISOString()).toBe("2026-10-26T15:58:12.000Z");
    expect(rows[1]).toMatchObject({ kind: "salida", method: "rostro" });
  });

  it("apagado por omisión; solo guarda de relojes autorizados y sin duplicar", async () => {
    await prisma.setting.deleteMany({ where: { key: "checador.adms" } });
    expect(await admsContact(prisma, "cqz-123", "1.2.3.4")).toEqual({ sn: "CQZ123", allowed: false });
    expect((await getAdmsConfig(prisma)).devices.CQZ123.ip).toBe("1.2.3.4");
    await setAdmsConfig(prisma, true, ["cqz123"]);
    expect((await admsContact(prisma, "CQZ123")).allowed).toBe(true);
    await prisma.employee.create({ data: { employeeNo: no, name: "Ficticio ZK", workdays: [] } });
    const body = `${no}\t2026-10-26 09:58:12\t0\t1\t0\t0\n${no}\t2026-10-26 18:01:00\t1\t1\t0\t0`;
    expect(await admsReceiveAttlog(prisma, "CQZ123", body)).toMatchObject({ added: 2, duplicates: 0 });
    expect(await admsReceiveAttlog(prisma, "CQZ123", body)).toMatchObject({ added: 0, duplicates: 2 });
    expect((await getAdmsConfig(prisma)).devices.CQZ123.punches).toBe(2);
  });
});
