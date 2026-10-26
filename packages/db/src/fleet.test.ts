import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  prisma, createMorningCheck, createBeforeRouteCheck, startRepair, closeRepair, discardFault,
  upsertVehicleDocument, expiringDocuments, vehiclesWithoutMorningCheck, fleetReport,
} from "./index.ts";

const n = 600000 + Number(String(Date.now()).slice(-5));
let vid = "", ana = "", beto = "";
const at = (s: string) => new Date(`${s}-06:00`);
const photos = ["a.jpg", "b.jpg", "c.jpg", "d.jpg"];

beforeAll(async () => {
  vid = (await prisma.vehicle.create({ data: { code: `M-T${n}`, plate: "ABC123", km: 1000 } })).id;
  ana = (await prisma.employee.create({ data: { employeeNo: n, name: "Ana Moto" } })).id;
  beto = (await prisma.employee.create({ data: { employeeNo: n + 1, name: "Beto Moto" } })).id;
});
afterAll(async () => {
  await prisma.employeeCharge.deleteMany({ where: { employeeId: { in: [ana, beto] } } });
  await prisma.repair.deleteMany({ where: { vehicleId: vid } });
  await prisma.fault.deleteMany({ where: { vehicleId: vid } });
  await prisma.fuelLoad.deleteMany({ where: { vehicleId: vid } });
  await prisma.vehicleCheck.deleteMany({ where: { vehicleId: vid } });
  await prisma.auditLog.deleteMany({ where: { summary: { contains: `M-T${n}` } } });
  await prisma.vehicle.delete({ where: { id: vid } });
  await prisma.employee.deleteMany({ where: { id: { in: [ana, beto] } } });
  await prisma.$disconnect();
});

describe("checks de la moto", () => {
  it("exige 4 fotos, odómetro y km que no retroceda; uno por día", async () => {
    expect(await createMorningCheck(prisma, { vehicleId: vid, employeeId: ana, km: 1100, photos: photos.slice(0, 3), odometerKey: "o.jpg" })).toMatchObject({ ok: false });
    expect(await createMorningCheck(prisma, { vehicleId: vid, employeeId: ana, km: 900, photos, odometerKey: "o.jpg" })).toMatchObject({ ok: false, error: expect.stringMatching(/menor/) });
    const d1 = await createMorningCheck(prisma, { vehicleId: vid, employeeId: ana, km: 1050, photos, odometerKey: "o.jpg", fuel: { amount: 150, liters: 6 }, now: at("2026-10-19T09:30:00") });
    expect(d1).toMatchObject({ ok: true, kmDriven: null });
    expect(await createMorningCheck(prisma, { vehicleId: vid, employeeId: ana, km: 1060, photos, odometerKey: "o.jpg", now: at("2026-10-19T10:00:00") })).toMatchObject({ ok: false, error: expect.stringMatching(/ya tiene/) });
    const d2 = await createMorningCheck(prisma, {
      vehicleId: vid, employeeId: beto, km: 1180, photos, odometerKey: "o.jpg", now: at("2026-10-20T09:30:00"),
      faults: [{ description: "Luz trasera fundida", severity: "baja" }], fuel: { amount: 180, liters: 7.5 },
    });
    expect(d2).toMatchObject({ ok: true, kmDriven: 130 }); // km de jornada a jornada
    const f = await prisma.fault.findFirstOrThrow({ where: { vehicleId: vid, kind: "reportada" } });
    expect(f).toMatchObject({ reportedById: beto, responsibleId: beto });
  });

  it("antes de ruta: el daño no reportado es de quien hizo el check matutino", async () => {
    const r = await createBeforeRouteCheck(prisma, { vehicleId: vid, employeeId: ana, photos: ["x.jpg"], description: "Espejo roto", now: at("2026-10-20T10:15:00") });
    expect(r.ok).toBe(true);
    const f = await prisma.fault.findFirstOrThrow({ where: { vehicleId: vid, kind: "no_reportada" } });
    expect(f).toMatchObject({ reportedById: ana, responsibleId: beto });
  });
});

describe("reparaciones", () => {
  it("mal uso: el empleado paga y queda su adeudo; la moto vuelve a activa", async () => {
    const f = await prisma.fault.findFirstOrThrow({ where: { vehicleId: vid, kind: "no_reportada" } });
    const s = await startRepair(prisma, f.id, "mecanico");
    expect(s.ok).toBe(true);
    if (!s.ok) return;
    expect((await prisma.vehicle.findUniqueOrThrow({ where: { id: vid } })).status).toBe("TALLER");
    expect(await startRepair(prisma, f.id, "mecanico")).toMatchObject({ ok: false });
    expect(await closeRepair(prisma, s.repairId, { description: "Cambio de espejo", photos: [], partsCost: 250, laborCost: 50, cause: "mal_uso", responsibleId: beto })).toMatchObject({ ok: false });
    expect(await closeRepair(prisma, s.repairId, { description: "Cambio de espejo", photos: ["r.jpg"], partsCost: 250, laborCost: 50, cause: "mal_uso", responsibleId: beto })).toEqual({ ok: true });
    const charge = await prisma.employeeCharge.findFirstOrThrow({ where: { repairId: s.repairId } });
    expect([charge.employeeId, charge.amount.toString()]).toEqual([beto, "300"]);
    expect((await prisma.vehicle.findUniqueOrThrow({ where: { id: vid } })).status).toBe("ACTIVO");
  });
  it("ambos: reparte el monto; desgaste: paga la empresa", async () => {
    const f = await prisma.fault.findFirstOrThrow({ where: { vehicleId: vid, kind: "reportada" } });
    const s = await startRepair(prisma, f.id, "mecanico");
    if (!s.ok) throw new Error(s.error);
    expect(await closeRepair(prisma, s.repairId, { description: "Foco", photos: ["r.jpg"], partsCost: 80, laborCost: 0, cause: "ambos", responsibleId: beto, employeeAmount: 80 })).toMatchObject({ ok: false });
    expect(await closeRepair(prisma, s.repairId, { description: "Foco", photos: ["r.jpg"], partsCost: 80, laborCost: 0, cause: "ambos", responsibleId: beto, employeeAmount: 30 })).toEqual({ ok: true });
    const r = await prisma.repair.findUniqueOrThrow({ where: { id: s.repairId } });
    expect([r.employeeAmount.toString(), r.companyAmount.toString()]).toEqual(["30", "50"]);
  });
  it("descartar solo si sigue abierta", async () => {
    const x = await prisma.fault.create({ data: { vehicleId: vid, reportedById: ana, description: "ruido raro" } });
    expect(await discardFault(prisma, x.id, "No se encontró falla")).toBe(true);
    expect(await discardFault(prisma, x.id, "otra")).toBe(false);
  });
});

describe("documentos y reportes", () => {
  it("alerta de vencimientos y motos sin check", async () => {
    await upsertVehicleDocument(prisma, { vehicleId: vid, type: "seguro", expiresAt: "2026-11-05" });
    await upsertVehicleDocument(prisma, { vehicleId: vid, type: "seguro", expiresAt: "2026-11-06", folio: "P-1" }); // actualiza, no duplica
    const docs = (await expiringDocuments(prisma, 30, at("2026-10-26T12:00:00"))).filter((d) => d.vehicleId === vid);
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({ folio: "P-1", daysLeft: 11 });
    const missing = await vehiclesWithoutMorningCheck(prisma, at("2026-10-21T12:00:00"));
    expect(missing.map((v) => v.id)).toContain(vid);
  });
  it("costos y km por moto y por empleado", async () => {
    const r = await fleetReport(prisma, at("2026-10-19T00:00:00"), new Date(Date.now() + 86400_000));
    const v = r.byVehicle.find((x) => x.id === vid)!;
    expect(v).toMatchObject({ km: 130, fuelCost: 330, liters: 13.5, repairs: 2, repairCost: 380 });
    expect(r.byEmployee.find((e) => e.employeeId === beto)).toMatchObject({ km: 130, charges: 330 });
  });
});
