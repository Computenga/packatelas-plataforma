"use server";

import { redirect } from "next/navigation";
import { createCheckout, prisma } from "@packatelas/db";
import { requireClient } from "@/lib/client-scope";
import type { ActionState } from "@/components/action-form";

export async function payWithCardAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const { clientId, user } = await requireClient();
  const amount = Math.round(Number(String(fd.get("amount") ?? "").replace(/[$,\s]/g, "")) * 100) / 100;
  if (!Number.isFinite(amount) || amount <= 0) return { error: "Escribe un monto válido" };
  const base = process.env.PUBLIC_URL?.trim();
  if (!base) return { error: "El pago con tarjeta aún no está disponible" };
  // Máximo 10 intentos por hora por cliente.
  const recent = await prisma.mpCheckout.count({ where: { clientId, createdAt: { gte: new Date(Date.now() - 3600_000) } } });
  if (recent >= 10) return { error: "Demasiados intentos; espera un momento" };
  let url: string;
  try {
    url = (await createCheckout(prisma, { clientId, amount, actorUserId: user.id, baseUrl: base })).url;
  } catch (e) {
    console.error("[mp] checkout:", e instanceof Error ? e.message : e);
    return { error: e instanceof Error && !e.message.startsWith("Mercado Pago ") ? e.message : "No se pudo abrir Mercado Pago; intenta de nuevo" };
  }
  redirect(url);
}
