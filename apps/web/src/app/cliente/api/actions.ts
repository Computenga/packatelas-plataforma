"use server";
import { revalidatePath } from "next/cache";
import { audit, createApiKey, disableWebhook, prisma, retryWebhook, revokeApiKey, rotateWebhookSecret, saveWebhook } from "@packatelas/db";
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
