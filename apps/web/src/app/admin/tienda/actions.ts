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
}

export async function readyAction(id: string) {
  const user = await requireUser(["ADMIN", "DESPACHADOR", "OPERADOR"]);
  const o = await prisma.storeOrder.update({ where: { id }, data: { status: "READY" } });
  await audit(prisma, { actorUserId: user.id, action: "store.ready", entity: "StoreOrder", entityId: o.id, summary: `Pedido de tienda T-${o.number} preparado` });
  revalidatePath("/admin/tienda");
}
