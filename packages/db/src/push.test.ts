import "dotenv/config";
import { afterAll, describe, expect, it } from "vitest";
import { prisma, savePushSubscription, sendPush, vapidKeys } from "./index.ts";

process.env.ENCRYPTION_KEY ??= Buffer.alloc(32, 9).toString("base64");
const ep = `https://push.example.com/${Date.now()}`;
let userId: string;

afterAll(async () => {
  await prisma.pushSubscription.deleteMany({ where: { endpoint: { startsWith: ep } } });
  await prisma.$disconnect();
});

describe("push", () => {
  it("crea llaves VAPID una sola vez y las reutiliza", async () => {
    const a = await vapidKeys(prisma);
    const b = await vapidKeys(prisma);
    expect(a.publicKey).toBe(b.publicKey);
    expect(a.publicKey.length).toBeGreaterThan(40);
  });

  it("envía a los dispositivos del usuario y borra los que ya no existen", async () => {
    userId = (await prisma.user.findFirstOrThrow({ where: { role: "ADMIN" } })).id;
    await savePushSubscription(prisma, userId, { endpoint: `${ep}/a`, keys: { p256dh: "x", auth: "y" } });
    await savePushSubscription(prisma, userId, { endpoint: `${ep}/b`, keys: { p256dh: "x", auth: "y" } });
    const seen: string[] = [];
    const r = await sendPush(prisma, [userId], { title: "Hola", body: "Prueba" }, async (s, payload) => {
      seen.push(payload);
      if (s.endpoint.endsWith("/b")) throw Object.assign(new Error("gone"), { statusCode: 410 });
    });
    expect(r.removed).toBe(1);
    expect(r.sent).toBeGreaterThanOrEqual(1);
    expect(JSON.parse(seen[0])).toMatchObject({ title: "Hola" });
    expect(await prisma.pushSubscription.count({ where: { endpoint: `${ep}/b` } })).toBe(0);
    await expect(savePushSubscription(prisma, userId, { endpoint: "http://inseguro", keys: { p256dh: "x", auth: "y" } })).rejects.toThrow();
  });
});
