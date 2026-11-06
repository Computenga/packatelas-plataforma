import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admsCommandResults, admsCommands, admsContact, admsReceiveAttlog, admsReceiveUsers, getAdmsConfig, parseAttlog, prisma, setAdmsConfig, zkName } from "./index.ts";

const no = 900000 + Math.floor(Math.random() * 9999);
afterAll(async () => {
  await prisma.punch.deleteMany({ where: { employee: { employeeNo: no } } });
  await prisma.employee.deleteMany({ where: { employeeNo: no } });
  await prisma.setting.deleteMany({ where: { key: { startsWith: "checador.adms" } } });
  await prisma.$disconnect();
});

describe("ZKTeco ADMS", () => {
  it("interpreta ATTLOG en hora de CDMX y descarta renglones inválidos", () => {
    const now = new Date("2026-10-27T12:00:00-06:00").getTime();
    const { rows, skipped } = parseAttlog("15\t2026-10-26 09:58:12\t0\t1\t0\t0\nbasura\n15\t2026-10-26 18:01:00\t1\t15\t0\n15\t2026-11-30 08:00:00\t0\t1\n15\t2026-01-01 08:00:00\t0\t1", "SN1", "-06:00", now);
    expect(skipped).toBe(3); // basura, futuro y de hace meses
    expect(rows[0]).toMatchObject({ employeeNo: 15, kind: "entrada", method: "huella", device: "ZKTeco SN1" });
    expect(rows[0].at.toISOString()).toBe("2026-10-26T15:58:12.000Z");
    expect(rows[1]).toMatchObject({ kind: "salida", method: "rostro" });
  });

  it("apagado por omisión; exige número de serie (e IP si se configuró); los contactos no cambian la configuración", async () => {
    await prisma.setting.deleteMany({ where: { key: { startsWith: "checador.adms" } } });
    expect(await admsContact(prisma, "cqz-123", "1.2.3.4", "fw")).toEqual({ sn: "CQZ123", allowed: false });
    expect((await getAdmsConfig(prisma)).devices.CQZ123.ip).toBe("1.2.3.4");
    await setAdmsConfig(prisma, true, ["cqz123"], ["1.2.3.4"]);
    expect((await admsContact(prisma, "CQZ123", "1.2.3.4")).allowed).toBe(true);
    expect((await admsContact(prisma, "CQZ123", "9.9.9.9")).allowed).toBe(false); // serie correcta, IP ajena
    // Sin IP configurada basta con el número de serie; otro número de serie sigue sin pasar.
    await setAdmsConfig(prisma, true, ["cqz123"], []);
    expect((await admsContact(prisma, "CQZ123", "9.9.9.9")).allowed).toBe(true);
    expect((await admsContact(prisma, "OTRO2", "9.9.9.9")).allowed).toBe(false);
    // Una petición pública no puede reactivar la recepción que el admin apagó.
    await setAdmsConfig(prisma, false, ["cqz123"], ["1.2.3.4"]);
    await admsContact(prisma, "OTRO1", "5.5.5.5", "x");
    expect((await getAdmsConfig(prisma)).enabled).toBe(false);
    await setAdmsConfig(prisma, true, ["cqz123"], ["1.2.3.4"]);
    await prisma.employee.create({ data: { employeeNo: no, name: "Ficticio ZK", workdays: [] } });
    const d1 = new Date(Date.now() - 86400_000).toISOString().slice(0, 10);
    const body = `${no}\t${d1} 09:58:12\t0\t1\t0\t0\n${no}\t${d1} 18:01:00\t1\t1\t0\t0`;
    expect(await admsReceiveAttlog(prisma, "CQZ123", body)).toMatchObject({ added: 2, duplicates: 0 });
    expect(await admsReceiveAttlog(prisma, "CQZ123", body)).toMatchObject({ added: 0, duplicates: 2 });
    expect((await getAdmsConfig(prisma)).devices.CQZ123.punches).toBe(2);
  });
});

describe("altas al reloj ZKTeco", () => {
  const sn = `TEST${Date.now()}`;
  const uno = 89000 + Number(String(Date.now()).slice(-3));
  beforeAll(async () => {
    await setAdmsConfig(prisma, true, [sn], [], true);
    await prisma.employee.create({ data: { employeeNo: uno, name: "José Ñúñez Pérez Prueba Larguísimo" } });
  });
  afterAll(async () => { await prisma.employee.deleteMany({ where: { employeeNo: uno } }); });
  it("primero pide la lista de usuarios y solo da de alta los que faltan, sin tocar los existentes", async () => {
    const c1 = await admsCommands(prisma, sn);
    expect(c1).toHaveLength(1);
    expect(c1[0]).toMatch(/^C:\d+:DATA QUERY USERINFO$/);
    // Mientras no llega la lista, no se manda nada más.
    expect(await admsCommands(prisma, sn)).toEqual([]);
    await admsReceiveUsers(prisma, sn, "USER PIN=1\tName=Admin\tPri=14\nUSER PIN=2\tName=Otro\tPri=0\n");
    const c2 = await admsCommands(prisma, sn);
    const mine = c2.find((c) => c.includes(`PIN=${uno}\t`))!;
    expect(mine).toMatch(new RegExp(`^C:(\\d+):DATA UPDATE USERINFO PIN=${uno}\\tName=Jose Nunez Perez Prueba\\tPri=0`));
    expect(c2.some((c) => /PIN=1\t|PIN=2\t/.test(c))).toBe(false);
    const id = mine.split(":")[1];
    await admsCommandResults(prisma, sn, `ID=${id}&Return=0&CMD=DATA\n`);
    expect((await admsCommands(prisma, sn)).some((c) => c.includes(`PIN=${uno}\t`))).toBe(false);
  });
  it("limpia nombres", () => expect(zkName("Ángel\tMoctezuma")).toBe("Angel Moctezuma"));
});
