"use server";

import { revalidatePath } from "next/cache";
import { audit, prisma } from "@packatelas/db";
import { requireUser } from "@/lib/auth";

export async function toggleProductAction(id: string) {
  await requireUser(["ADMIN"]);
  const p = await prisma.storeProduct.findUniqueOrThrow({ where: { id } });
  await prisma.storeProduct.update({ where: { id }, data: { active: !p.active } });
  revalidatePath("/admin/tienda");
  revalidatePath("/cliente/tienda");
}

/** Mostrar u ocultar varios a la vez (todos, o los de una categoría). */
export async function bulkVisibleAction(active: boolean, category: string | null) {
  await requireUser(["ADMIN"]);
  await prisma.storeProduct.updateMany({ where: category ? { category } : {}, data: { active } });
  revalidatePath("/admin/tienda");
  revalidatePath("/cliente/tienda");
}

export async function readyAction(id: string) {
  const user = await requireUser(["ADMIN", "DESPACHADOR", "OPERADOR"]);
  const o = await prisma.storeOrder.update({ where: { id }, data: { status: "READY" } });
  await audit(prisma, { actorUserId: user.id, action: "store.ready", entity: "StoreOrder", entityId: o.id, summary: `Pedido de tienda IN-${String(o.number).padStart(5, "0")} preparado` });
  revalidatePath("/admin/tienda");
}
