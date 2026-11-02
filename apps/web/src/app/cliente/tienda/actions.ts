"use server";

import { redirect } from "next/navigation";
import { placeStoreOrder, prisma } from "@packatelas/db";
import { requireClient } from "@/lib/client-scope";

export type CheckoutState = { error?: string };

export async function checkoutAction(_: CheckoutState, fd: FormData): Promise<CheckoutState> {
  const { clientId, user } = await requireClient();
  let cart: { productId: string; qty: number }[];
  try {
    cart = (JSON.parse(String(fd.get("cart") ?? "[]")) as { productId: string; qty: number }[]).map((c) => ({ productId: String(c.productId), qty: Math.floor(Number(c.qty)) }));
  } catch {
    return { error: "Carrito inválido" };
  }
  const pay = fd.get("pay") === "saldo" ? "saldo" : "tarjeta";
  const base = process.env.PUBLIC_URL?.trim() ?? "";
  const recent = await prisma.storeOrder.count({ where: { clientId, createdAt: { gte: new Date(Date.now() - 3600_000) } } });
  if (recent >= 15) return { error: "Demasiados pedidos seguidos; espera un momento" };
  let r: { id: string; url: string | null };
  try {
    r = await placeStoreOrder(prisma, { clientId, userId: user.id, branchId: String(fd.get("branchId") ?? ""), cart, pay, baseUrl: base });
  } catch (e) {
    console.error("[tienda] pedido", e instanceof Error ? e.message : e);
    return { error: e instanceof Error && !e.message.startsWith("Mercado Pago ") ? e.message : "No se pudo abrir el pago; intenta de nuevo" };
  }
  redirect(r.url ?? `/cliente/tienda?pedido=${r.id}`);
}
