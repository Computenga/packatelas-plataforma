"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { addOrderEvent, audit, createManualOrder, prisma, rescheduleOrder, sendToWarehouse } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import type { ActionState } from "@/components/action-form";
import { orderFields, toManualInput } from "@/lib/order-schema";

const orderSchema = orderFields.extend({ clientId: z.string().min(1, "Elige el cliente") });

export async function createOrder(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser(["ADMIN", "OPERADOR"]);
  const parsed = orderSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  const client = await prisma.client.findUnique({ where: { id: d.clientId }, include: { branches: { where: { active: true } } } });
  if (!client || !client.active) return { error: "Cliente no encontrado o inactivo" };
  const branchId = d.branchId && client.branches.some((b) => b.id === d.branchId) ? d.branchId : client.branches[0]?.id;

  const order = await createManualOrder(prisma, toManualInput(d, client.id, branchId), user.id);
  redirect(`/admin/pedidos/${order.id}`);
}

export async function cancelOrder(orderId: string) {
  const user = await requireUser(["ADMIN"]);
  const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
  if (["DELIVERED", "CANCELLED", "RETURNED_TO_SELLER"].includes(order.status)) return;
  await prisma.$transaction(async (tx) => {
    await addOrderEvent(tx, { orderId, type: "cancelled", source: "ADMIN", toStatus: "CANCELLED", actorUserId: user.id });
    await audit(tx, { actorUserId: user.id, action: "order.cancelled", entity: "Order", entityId: orderId, summary: `Pedido ${order.code} cancelado` });
  });
  revalidatePath(`/admin/pedidos/${orderId}`);
}

const FAILURE_ROLES = ["ADMIN", "OPERADOR", "DESPACHADOR"] as const;

function revalidateOrder(orderId: string) {
  revalidatePath(`/admin/pedidos/${orderId}`);
  revalidatePath("/admin/despacho");
  revalidatePath("/admin/devoluciones");
}

/** Despacho decide que el paquete regrese a bodega [A11]. */
export async function sendToWarehouseAction(orderId: string): Promise<ActionState> {
  const user = await requireUser([...FAILURE_ROLES]);
  const r = await sendToWarehouse(prisma, orderId, user.id);
  if (!r.ok) return { error: r.error };
  revalidateOrder(orderId);
  return { ok: "Marcado para regresar a bodega" };
}

/** Vuelve a la cola de despacho, con fecha opcional [A11]. */
export async function rescheduleAction(orderId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser([...FAILURE_ROLES]);
  const raw = String(fd.get("date") ?? "");
  const date = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T12:00:00-06:00`) : undefined;
  const note = String(fd.get("note") ?? "").trim().slice(0, 200) || undefined;
  const r = await rescheduleOrder(prisma, orderId, { date, note }, user.id);
  if (!r.ok) return { error: r.error };
  revalidateOrder(orderId);
  return { ok: "Reprogramado: ya está en Por asignar" };
}

/** Despacho por lotes: varias órdenes a bodega o a reprogramar. */
export async function bulkFailureAction(orderIds: string[], action: "warehouse" | "reschedule"): Promise<{ ok?: string; error?: string }> {
  const user = await requireUser([...FAILURE_ROLES]);
  const list = Array.isArray(orderIds) ? orderIds.filter((x): x is string => typeof x === "string").slice(0, 500) : [];
  let n = 0;
  for (const id of list) {
    const r = action === "warehouse" ? await sendToWarehouse(prisma, id, user.id) : await rescheduleOrder(prisma, id, {}, user.id);
    if (r.ok) n++;
  }
  revalidatePath("/admin/despacho");
  revalidatePath("/admin/devoluciones");
  const skipped = list.length - n;
  const what = action === "warehouse" ? "para regresar a bodega" : "reprogramado(s)";
  return n ? { ok: `${n} pedido(s) ${what}${skipped ? ` · ${skipped} no aplicaban` : ""}` } : { error: "Ninguno de los seleccionados aplica" };
}
