"use server";

import { redirect } from "next/navigation";
import { createManualOrder, prisma } from "@packatelas/db";
import { requireClient } from "@/lib/client-scope";
import { orderFields, toManualInput } from "@/lib/order-schema";
import type { ActionState } from "@/components/action-form";

/** La tienda registra un envío fuera de MercadoLibre [C04]. */
export async function createClientOrder(_: ActionState, fd: FormData): Promise<ActionState> {
  const { user, clientId } = await requireClient();
  const parsed = orderFields.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;
  const client = await prisma.client.findUnique({ where: { id: clientId }, include: { branches: { where: { active: true } } } });
  if (!client?.active) return { error: "Tu cuenta está inactiva; contacta a Packatelas" };
  const branchId = d.branchId && client.branches.some((b) => b.id === d.branchId) ? d.branchId : client.branches[0]?.id;
  const order = await createManualOrder(prisma, { ...toManualInput(d, clientId, branchId), eventSource: "CLIENT" }, user.id);
  redirect(`/cliente/envio/${order.id}?nuevo=1`);
}
