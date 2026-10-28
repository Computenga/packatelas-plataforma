import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectCourier, courierAccount, enqueueCourierReport, getCourierSettings, prisma, processCourierReports, saveCourierSettings, sendCourierReport } from "./index.ts";

process.env.ML_CLIENT_ID = "123";
process.env.ML_CLIENT_SECRET = "s";
process.env.PUBLIC_URL = "https://ejemplo.mx";
process.env.ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");

const SID = 47000000000n + BigInt(Date.now() % 1000000);
const calls: { url: string; body?: string; auth?: string }[] = [];
let user = 97333751;
let reply = { status: 200, body: { ok: true } as unknown };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });
const fakeFetch = (async (url: string | URL, init?: RequestInit) => {
  const u = String(url);
  calls.push({ url: u, body: init?.body ? String(init.body) : undefined, auth: (init?.headers as Record<string, string> | undefined)?.Authorization });
  if (u.endsWith("/oauth/token")) return json({ access_token: "COURIER_AT", refresh_token: "RT", expires_in: 21600, user_id: user });
  if (u.endsWith("/users/me")) return json({ id: user, nickname: "PACKATELAS_MENSAJERIA", email: "x@ejemplo.mx" });
  if (u.includes("/courier-shipment/v1")) return json(reply.body, reply.status);
  return json({}, 404);
}) as typeof fetch;

let prevSettings: unknown, prevAccount: unknown, adminId = "";
beforeAll(async () => {
  adminId = (await prisma.user.findFirstOrThrow({ where: { role: "ADMIN" } })).id;
  prevSettings = (await prisma.setting.findUnique({ where: { key: "ml.courier.settings" } }))?.value;
  prevAccount = (await prisma.setting.findUnique({ where: { key: "ml.courier.account" } }))?.value;
  await prisma.setting.deleteMany({ where: { key: { in: ["ml.courier.settings", "ml.courier.account"] } } });
});
afterAll(async () => {
  await prisma.mlCourierReport.deleteMany({ where: { shipmentId: { in: [SID, SID + 1n, SID + 2n] } } });
  await prisma.setting.deleteMany({ where: { key: { in: ["ml.courier.settings", "ml.courier.account"] } } });
  if (prevSettings) await prisma.setting.create({ data: { key: "ml.courier.settings", value: prevSettings as object } });
  if (prevAccount) await prisma.setting.create({ data: { key: "ml.courier.account", value: prevAccount as object } });
  await prisma.$disconnect();
});

describe("Mensajería Flex", () => {
  it("arranca apagado y esperando la cuenta 97333751", async () => {
    expect(await getCourierSettings(prisma)).toMatchObject({ enabled: false, expectedUserId: "97333751", site: "MLM" });
  });

  it("rechaza autorizar con otra cuenta y acepta la correcta (token cifrado)", async () => {
    user = 11111;
    const bad = await connectCourier(prisma, "C", null, fakeFetch);
    expect(bad.ok).toBe(false);
    expect(await courierAccount(prisma)).toBeNull();
    user = 97333751;
    expect(await connectCourier(prisma, "C", adminId, fakeFetch)).toMatchObject({ ok: true, userId: "97333751" });
    const raw = JSON.stringify((await prisma.setting.findUniqueOrThrow({ where: { key: "ml.courier.account" } })).value);
    expect(raw).not.toContain("COURIER_AT");
  });

  it("apagado: escanear no encola y el worker no manda nada", async () => {
    expect(await enqueueCourierReport(prisma, SID + 1n)).toBe(false);
    expect(await prisma.mlCourierReport.count({ where: { shipmentId: SID + 1n } })).toBe(0);
    const before = calls.length;
    expect((await processCourierReports(prisma, 10, fakeFetch)).seen).toBe(0);
    expect(calls.length).toBe(before);
  });

  it("la prueba manual manda UN envío con el usuario y token de la mensajería al sitio MLM", async () => {
    const r = await sendCourierReport(prisma, SID, { source: "prueba", actorUserId: adminId, fetchImpl: fakeFetch });
    expect(r.status).toBe("sent");
    const call = calls.find((c) => c.url.includes("courier-shipment"))!;
    expect(call.url).toBe("https://api.mercadolibre.com/flex/sites/MLM/users/97333751/courier-shipment/v1");
    expect(call.auth).toBe("Bearer COURIER_AT");
    expect(JSON.parse(call.body!)).toEqual({ shipment_id: Number(SID) });
    // No se repite.
    expect((await sendCourierReport(prisma, SID, { fetchImpl: fakeFetch })).status).toBe("already");
  });

  it("un 4xx queda como fallido con la respuesta de ML; un 5xx se reintenta", async () => {
    reply = { status: 403, body: { message: "forbidden" } };
    const r = await sendCourierReport(prisma, SID + 2n, { fetchImpl: fakeFetch });
    expect(r.row.status).toBe("FAILED");
    expect(r.row.response).toContain("forbidden");
    await prisma.mlCourierReport.delete({ where: { shipmentId: SID + 2n } });
    reply = { status: 503, body: {} };
    expect((await sendCourierReport(prisma, SID + 2n, { fetchImpl: fakeFetch })).row.status).toBe("PENDING");
    reply = { status: 200, body: { ok: true } };
  });

  it("encendido: escanear encola y el worker lo manda", async () => {
    await saveCourierSettings(prisma, { enabled: true }, adminId);
    expect(await enqueueCourierReport(prisma, SID + 1n)).toBe(true);
    await prisma.mlCourierReport.updateMany({ where: { shipmentId: { in: [SID + 1n, SID + 2n] } }, data: { runAfter: new Date(0) } });
    const r = await processCourierReports(prisma, 10, fakeFetch);
    expect(r.sent).toBeGreaterThanOrEqual(1);
    expect((await prisma.mlCourierReport.findUniqueOrThrow({ where: { shipmentId: SID + 1n } })).status).toBe("SENT");
  });
});
