"use server";

import { revalidatePath } from "next/cache";
import { audit, prisma, syncStoreCatalog } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import type { ActionState } from "@/components/action-form";

export async function syncCatalogAction(_: ActionState): Promise<ActionState> {
  await requireUser(["ADMIN"]);
  try {
    const r = await syncStoreCatalog(prisma);
    revalidatePath("/admin/tienda");
    return { ok: `Catálogo actualizado: ${r.products} productos` };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "No se pudo leer la tienda" };
  }
}

export async function toggleProductAction(id: string) {
  await requireUser(["ADMIN"]);
  const p = await prisma.storeProduct.findUniqueOrThrow({ where: { id } });
  await prisma.storeProduct.update({ where: { id }, data: { active: !p.active } });
  revalidatePath("/admin/tienda");
  revalidatePath("/cliente/tienda");
}

export async function readyAction(id: string) {
  const user = await requireUser(["ADMIN", "DESPACHADOR", "OPERADOR"]);
  const o = await prisma.storeOrder.update({ where: { id }, data: { status: "READY" } });
  await audit(prisma, { actorUserId: user.id, action: "store.ready", entity: "StoreOrder", entityId: o.id, summary: `Pedido de tienda T-${o.number} preparado` });
  revalidatePath("/admin/tienda");
}

/** Precio del portal: vacío = usar el de WooCommerce. */
export async function setPortalPriceAction(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser(["ADMIN"]);
  const raw = String(fd.get("price") ?? "").replace(/[$,\s]/g, "");
  const value = raw === "" ? null : Number(raw);
  if (value !== null && !(Number.isFinite(value) && value > 0 && value < 1_000_000)) return { error: "Precio inválido" };
  const p = await prisma.storeProduct.update({ where: { id }, data: { portalPrice: value === null ? null : value.toFixed(2) } });
  await audit(prisma, { actorUserId: user.id, action: "store.price", entity: "StoreProduct", entityId: id, summary: value === null ? `${p.name}: precio de WooCommerce` : `${p.name}: precio en el portal $${value.toFixed(2)} (WooCommerce $${p.price})` });
  revalidatePath("/admin/tienda");
  revalidatePath("/cliente/tienda");
  return { ok: value === null ? "Usa el de WooCommerce" : "Guardado" };
}

/** Mostrar u ocultar varios a la vez (todos, o los de una categoría). */
export async function bulkVisibleAction(active: boolean, category: string | null) {
  await requireUser(["ADMIN"]);
  await prisma.storeProduct.updateMany({ where: category ? { category } : {}, data: { active } });
  revalidatePath("/admin/tienda");
  revalidatePath("/cliente/tienda");
}
