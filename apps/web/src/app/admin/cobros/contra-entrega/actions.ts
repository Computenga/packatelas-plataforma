"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createCodPayout, mxnText, notifyClient, prisma, receiveDriverCash } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import type { ActionState } from "@/components/action-form";

const PATH = "/admin/cobros/contra-entrega";

export async function receiveCashAction(driverId: string): Promise<ActionState> {
  const user = await requireUser(["ADMIN"]);
  try {
    const r = await receiveDriverCash(prisma, driverId, user.id);
    revalidatePath(PATH);
    return { ok: `Recibido ${mxnText(r.total)} (${r.count} pedido(s))` };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "No se pudo registrar" };
  }
}

export async function payoutAction(clientId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser(["ADMIN"]);
  const parsed = z
    .object({
      reference: z.string().trim().min(3, "Escribe la referencia o clave de rastreo").max(100),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida"),
      note: z.string().trim().max(300).optional(),
      orderIds: z.array(z.string().min(1).max(40)).min(1, "Selecciona al menos un pedido"),
    })
    .safeParse({ ...Object.fromEntries(fd), orderIds: fd.getAll("orderId") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;
  try {
    const r = await createCodPayout(prisma, { clientId, reference: d.reference, paidAt: new Date(`${d.date}T12:00:00-06:00`), note: d.note, orderIds: d.orderIds }, user.id);
    await notifyClient(prisma, clientId, "contra_entrega", {
      title: "Te transferimos tus cobros contra entrega",
      body: `${mxnText(r.amount)} de ${r.count} envío(s) · ref. ${d.reference}`,
      url: "/cliente/contra-entrega",
      tag: `cod-${r.id}`,
    }).catch(() => null);
    revalidatePath(PATH);
    return { ok: `Transferencia de ${mxnText(r.amount)} registrada (${r.count} pedido(s))` };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "No se pudo registrar" };
  }
}
