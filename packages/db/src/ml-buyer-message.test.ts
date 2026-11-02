import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
process.env.ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");
import { prisma, encryptSecret, sendDeliveryPromise } from "./index.ts";

const tag = `bm${Date.now()}`;
let clientId: string, orderId: string, accId: string;
const s = { enabled: true, fromHour: 14, toHour: 21, trigger: "ASSIGNED" as const };

beforeAll(async () => {
  clientId = (await prisma.client.create({ data: { publicId: tag, name: "T", paymentReference: tag, tariffAmount: 85 } })).id;
  accId = (await prisma.mlAccount.create({
    data: { clientId, mlUserId: BigInt(Date.now()), nickname: tag, status: "ACTIVE", accessTokenEnc: encryptSecret("tok"), refreshTokenEnc: encryptSecret("ref"), tokenExpiresAt: new Date(Date.now() + 3600_000) },
  })).id;
  orderId = (await prisma.order.create({ data: { code: `${tag}-1`, source: "ML_FLEX", clientId, addressLine: "x", mlAccountId: accId, mlOrderId: 2000123n, status: "ASSIGNED" } })).id;
});
afterAll(async () => {
  await prisma.order.deleteMany({ where: { clientId } });
  await prisma.mlAccount.deleteMany({ where: { clientId } });
  await prisma.client.delete({ where: { id: clientId } });
  await prisma.$disconnect();
});

describe("aviso al comprador por Mercado Libre [I13]", () => {
  it("usa la plantilla DELIVERY_PROMISE una sola vez", async () => {
    const calls: { url: string; body?: string }[] = [];
    const fake = (async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body as string | undefined });
      if (url.includes("?tag=post_sale") && !url.includes("/option")) return new Response(JSON.stringify({ options: [{ id: "DELIVERY_PROMISE", enabled: true, cap_available: 1 }] }));
      return new Response(JSON.stringify({ id: "m1", status: "available" }));
    }) as typeof fetch;
    expect((await sendDeliveryPromise(prisma, orderId, s, fake)).status).toBe("sent");
    const post = calls.find((c) => c.url.endsWith("/messages/action_guide/packs/2000123/option?tag=post_sale"))!;
    const body = JSON.parse(post.body!);
    expect(body.option_id).toBe("DELIVERY_PROMISE");
    expect(body.vars.map((v: { value: number }) => v.value)).toEqual([14, 21]);
    expect(JSON.stringify(body)).not.toMatch(/http|www|@/);
    expect((await sendDeliveryPromise(prisma, orderId, s, fake)).status).toBe("already");
  });
});
