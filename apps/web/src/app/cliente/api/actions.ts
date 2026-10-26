"use server";
import { revalidatePath } from "next/cache";
import { randomBytes } from "node:crypto";
import { audit, createApiKey, encryptSecret, disableWebhook, prisma, retryWebhook, revokeApiKey, rotateWebhookSecret, saveWebhook } from "@packatelas/db";
import type { ActionState } from "@/components/action-form";
import { requireClient } from "@/lib/client-scope";

export async function createKeyAction(_: unknown, fd: FormData): Promise<{ error?: string; key?: string }> {
  const { user, clientId } = await requireClient();
  try {
    const { key, id } = await createApiKey(prisma, clientId, String(fd.get("name") ?? ""));
    await audit(prisma, { actorUserId: user.id, action: "api.key_created", entity: "ApiKey", entityId: id, summary: `Llave de API creada (${key.slice(0, 12)}…)` });
    revalidatePath("/cliente/api");
    return { key };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "No se pudo crear" };
  }
}

export async function revokeKeyAction(id: string) {
  const { user, clientId } = await requireClient();
  if (await revokeApiKey(prisma, clientId, id)) {
    await audit(prisma, { actorUserId: user.id, action: "api.key_revoked", entity: "ApiKey", entityId: id, summary: "Llave de API revocada" });
  }
  revalidatePath("/cliente/api");
}

export async function saveWebhookAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const { user, clientId } = await requireClient();
  try {
    const ep = await saveWebhook(prisma, clientId, String(fd.get("url") ?? ""));
    await audit(prisma, { actorUserId: user.id, action: "api.webhook_saved", entity: "WebhookEndpoint", entityId: ep.id, summary: `Webhook: ${ep.url}` });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "URL inválida" };
  }
  revalidatePath("/cliente/api");
  return { ok: "Webhook guardado" };
}

export async function disableWebhookAction() {
  const { clientId } = await requireClient();
  await disableWebhook(prisma, clientId);
  revalidatePath("/cliente/api");
}

export async function rotateSecretAction() {
  const { user, clientId } = await requireClient();
  await rotateWebhookSecret(prisma, clientId);
  await audit(prisma, { actorUserId: user.id, action: "api.webhook_secret_rotated", entity: "WebhookEndpoint", summary: "Secreto de webhook renovado" });
  revalidatePath("/cliente/api");
}

export async function retryDeliveryAction(id: string) {
  const { clientId } = await requireClient();
  await retryWebhook(prisma, clientId, id);
  revalidatePath("/cliente/api");
}

export async function connectStoreAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const { user, clientId } = await requireClient();
  const platform = fd.get("platform") === "SHOPIFY" ? "SHOPIFY" : "WOOCOMMERCE";
  const name = String(fd.get("name") ?? "").trim().slice(0, 60) || (platform === "SHOPIFY" ? "Shopify" : "WooCommerce");
  const pasted = String(fd.get("secret") ?? "").trim();
  if (platform === "SHOPIFY" && (pasted.length < 16 || pasted.length > 200)) return { error: "Pega la clave con la que Shopify firma los webhooks" };
  if ((await prisma.storeConnector.count({ where: { clientId } })) >= 10) return { error: "Máximo 10 tiendas conectadas" };
  const branchId = String(fd.get("branchId") ?? "") || null;
  if (branchId && !(await prisma.branch.findFirst({ where: { id: branchId, clientId, active: true } }))) return { error: "Sucursal inválida" };
  const secret = platform === "SHOPIFY" ? pasted : `wc_${randomBytes(24).toString("base64url")}`;
  const c = await prisma.storeConnector.create({ data: { clientId, platform, name, branchId, secret: encryptSecret(secret) } });
  await audit(prisma, { actorUserId: user.id, action: "store.connected", entity: "StoreConnector", entityId: c.id, summary: `Tienda conectada: ${name} (${platform})` });
  revalidatePath("/cliente/api");
  return { ok: "Tienda agregada: sigue los pasos de abajo" };
}

export async function toggleStoreAction(id: string) {
  const { clientId } = await requireClient();
  const c = await prisma.storeConnector.findFirst({ where: { id, clientId } });
  if (c) await prisma.storeConnector.update({ where: { id }, data: { active: !c.active } });
  revalidatePath("/cliente/api");
}

export async function removeStoreAction(id: string) {
  const { user, clientId } = await requireClient();
  const r = await prisma.storeConnector.deleteMany({ where: { id, clientId } });
  if (r.count) await audit(prisma, { actorUserId: user.id, action: "store.removed", entity: "StoreConnector", entityId: id, summary: "Tienda desconectada" });
  revalidatePath("/cliente/api");
}
