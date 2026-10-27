import { createManualOrder, decryptSecret, Prisma, prisma, windowCount } from "@packatelas/db";
import { geocodeAddress } from "@/lib/geocode-providers";
import { readCapped } from "@/lib/iclock";
import { mapShopify, mapWoo, validSignature, type MapResult } from "@/lib/store-orders";

const MAX_BODY = 512 * 1024;

/** Webhook de pedidos de WooCommerce o Shopify del cliente → envío [I06]. */
export async function POST(request: Request, ctx: RouteContext<"/api/tiendas/[id]">) {
  const { id } = await ctx.params;
  const c = await prisma.storeConnector.findUnique({ where: { id }, include: { client: { select: { active: true } } } });
  if (!c) return new Response("No encontrado", { status: 404 });
  const raw = await readCapped(request, MAX_BODY);
  if (raw === null) return new Response("Demasiado grande", { status: 413 });

  const woo = c.platform === "WOOCOMMERCE";
  // WooCommerce manda un "ping" sin firma al guardar el webhook.
  if (woo && !request.headers.get("x-wc-webhook-topic") && /^webhook_id=\d+$/.test(raw.trim())) return new Response("ok");
  const sig = request.headers.get(woo ? "x-wc-webhook-signature" : "x-shopify-hmac-sha256");
  if (!validSignature(decryptSecret(c.secret), raw, sig)) return new Response("Firma inválida", { status: 401 });

  const log = (result: string, created = false) =>
    prisma.storeConnector.update({ where: { id }, data: { received: { increment: 1 }, ...(created ? { created: { increment: 1 } } : {}), lastAt: new Date(), lastResult: result.slice(0, 300) } });

  if (!c.active || !c.client.active) {
    await log("Conexión desactivada: pedido ignorado");
    return new Response("ok");
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    await log("Cuerpo inválido");
    return new Response("ok");
  }
  const m: MapResult = woo ? mapWoo(json as never) : mapShopify(json as never);
  if ("skip" in m) {
    await log(`Ignorado: ${m.skip}`);
    return new Response("ok");
  }
  const o = m.order;
  const existing = await prisma.order.findUnique({ where: { clientId_externalRef: { clientId: c.clientId, externalRef: o.ref } }, select: { code: true } });
  if (existing) {
    await log(`${o.ref} ya existía como ${existing.code}`);
    return new Response("ok");
  }
  let { lat, lng } = o;
  if ((lat == null || lng == null) && (await windowCount(prisma, `geocode:${c.clientId}`, 1440)) <= 1500) {
    const hit = await geocodeAddress([o.addressLine, o.neighborhood, o.city, o.state, o.zip].filter(Boolean).join(", ")).catch(() => null);
    if (hit) ({ lat, lng } = hit);
  }
  const branch = c.branchId
    ? await prisma.branch.findFirst({ where: { id: c.branchId, clientId: c.clientId, active: true }, select: { id: true } })
    : await prisma.branch.findFirst({ where: { clientId: c.clientId, active: true }, orderBy: { createdAt: "asc" }, select: { id: true } });
  try {
    const order = await createManualOrder(prisma, {
      clientId: c.clientId, branchId: branch?.id, recipientName: o.recipientName, recipientPhone: o.recipientPhone, addressLine: o.addressLine,
      neighborhood: o.neighborhood, city: o.city, state: o.state, zip: o.zip, lat, lng, instructions: o.instructions, itemsSummary: o.itemsSummary,
      externalRef: o.ref, source: "API", eventSource: "CLIENT",
    });
    await log(`${o.ref} → ${order.code}${lat == null ? " (sin ubicar en el mapa)" : ""}`, true);
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      await log(`${o.ref} ya existía`);
      return new Response("ok");
    }
    throw e;
  }
  return new Response("ok");
}
