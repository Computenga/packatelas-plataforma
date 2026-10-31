import "dotenv/config";
import { afterAll, describe, expect, it } from "vitest";
import { applyWhatsappStatuses, prisma } from "./index.ts";

const tag = `wa${Date.now()}`;
const wh = (id: string, status: string, extra = {}) => ({ entry: [{ changes: [{ value: { statuses: [{ id, status, timestamp: "1761940000", ...extra }] } }] }] });

afterAll(async () => {
  await prisma.notification.deleteMany({ where: { dedupeKey: { startsWith: tag } } });
  await prisma.$disconnect();
});

describe("estados de WhatsApp", () => {
  it("entregado → leído, sin regresar, y fallas con motivo en español", async () => {
    const base = { event: "recoleccion_asignada", to: "525500000000", template: "t", params: [], preview: "x", status: "SENT" as const };
    const a = await prisma.notification.create({ data: { ...base, dedupeKey: `${tag}a`, externalId: `${tag}-A` } });
    const b = await prisma.notification.create({ data: { ...base, dedupeKey: `${tag}b`, externalId: `${tag}-B` } });
    await applyWhatsappStatuses(prisma, wh(`${tag}-A`, "read"));
    await applyWhatsappStatuses(prisma, wh(`${tag}-A`, "delivered"));
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: a.id } })).status).toBe("READ");
    await applyWhatsappStatuses(prisma, wh(`${tag}-B`, "failed", { errors: [{ code: 131042, title: "Business eligibility payment issue" }] }));
    const fb = await prisma.notification.findUniqueOrThrow({ where: { id: b.id } });
    expect(fb.status).toBe("FAILED");
    expect(fb.error).toContain("método de pago");
  });
});
