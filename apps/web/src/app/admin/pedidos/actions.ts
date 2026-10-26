"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { addOrderEvent, audit, createManualOrder, prisma, rescheduleOrder, sendToWarehouse } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import type { ActionState } from "@/components/action-form";

const coord = (min: number, max: number) => z.union([z.coerce.number().min(min).max(max), z.literal("")]).optional();

const orderSchema = z.object({
  clientId: z.string().min(1, "Elige el cliente"),
  branchId: z.string().optional(),
  recipientName: z.string().trim().min(2, "Escribe el nombre de quien recibe"),
  recipientPhone: z.string().trim().regex(/^(\+?\d[\d\s-]{7,16})?$/, "Teléfono inválido").optional(),
  addressLine: z.string().trim().min(5, "Escribe la calle y número"),
  neighborhood: z.string().trim().optional(),
  city: z.string().trim().optional(),
  state: z.string().trim().optional(),
  zip: z.string().trim().regex(/^(\d{5})?$/, "Código postal inválido").optional(),
  lat: coord(14, 33),
  lng: coord(-118, -86),
  instructions: z.string().trim().max(500).optional(),
  itemsSummary: z.string().trim().max(200).optional(),
});

const blank = (v?: string) => (v ? v : undefined);

export async function createOrder(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser(["ADMIN", "OPERADOR"]);
  const parsed = orderSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  const client = await prisma.client.findUnique({ where: { id: d.clientId }, include: { branches: { where: { active: true } } } });
  if (!client || !client.active) return { error: "Cliente no encontrado o inactivo" };
  const branchId = d.branchId && client.branches.some((b) => b.id === d.branchId) ? d.branchId : client.branches[0]?.id;

  const order = await createManualOrder(
    prisma,
    {
      clientId: client.id,
      branchId,
      recipientName: d.recipientName,
      recipientPhone: blank(d.recipientPhone),
      addressLine: d.addressLine,
      neighborhood: blank(d.neighborhood),
      city: blank(d.city),
      state: blank(d.state),
      zip: blank(d.zip),
      lat: d.lat === "" ? undefined : d.lat,
      lng: d.lng === "" ? undefined : d.lng,
      instructions: blank(d.instructions),
      itemsSummary: blank(d.itemsSummary),
    },
    user.id,
  );
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
