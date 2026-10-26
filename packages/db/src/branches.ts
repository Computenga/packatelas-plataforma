// Sucursales: editar, desactivar y borrar sin romper historial ni el enrutamiento ML [A15, A02].
// Una sucursal con pedidos o recolecciones no se borra (es historial); se desactiva. Sin
// movimientos sí se borra. Nunca se deja al cliente sin sucursal activa, y las cuentas ML que
// llegaban a ella se reacomodan para seguir teniendo una sucursal predeterminada.
import type { Prisma, PrismaClient } from "../generated/prisma/client.ts";
import { audit } from "./orders.ts";

type Tx = Prisma.TransactionClient;
export type BranchResult = { ok: true; mode: "deleted" | "deactivated" | "reactivated" } | { ok: false; error: string };

/** Quita la sucursal de las cuentas ML y asegura que cada cuenta afectada conserve una predeterminada. */
async function detachFromMl(tx: Tx, branchId: string, clientId: string) {
  const routes = await tx.mlAccountRoute.findMany({ where: { branchId } });
  await tx.mlAccountRoute.deleteMany({ where: { branchId } });
  for (const accId of new Set(routes.map((r) => r.mlAccountId))) {
    const left = await tx.mlAccountRoute.findMany({ where: { mlAccountId: accId }, orderBy: { createdAt: "asc" } });
    if (left.some((r) => r.isDefault)) continue;
    if (left.length) {
      await tx.mlAccountRoute.update({ where: { mlAccountId_branchId: { mlAccountId: accId, branchId: left[0].branchId } }, data: { isDefault: true } });
    } else {
      const fallback = await tx.branch.findFirst({ where: { clientId, active: true, id: { not: branchId } }, orderBy: { createdAt: "asc" } });
      if (fallback) await tx.mlAccountRoute.create({ data: { mlAccountId: accId, branchId: fallback.id, isDefault: true } });
    }
  }
}

async function guardLastActive(tx: Tx, branchId: string, clientId: string) {
  const others = await tx.branch.count({ where: { clientId, active: true, id: { not: branchId } } });
  return others > 0;
}

/** Borra la sucursal si no tiene movimientos; si los tiene, la desactiva. */
export async function removeBranch(prisma: PrismaClient, branchId: string, actorUserId: string): Promise<BranchResult> {
  return prisma.$transaction(async (tx) => {
    const b = await tx.branch.findUnique({ where: { id: branchId }, include: { _count: { select: { orders: true, pickups: true } } } });
    if (!b) return { ok: false, error: "Sucursal no encontrada" };
    if (b.active && !(await guardLastActive(tx, b.id, b.clientId))) {
      return { ok: false, error: "Es la única sucursal activa del cliente. Agrega otra antes de quitar esta." };
    }
    await detachFromMl(tx, b.id, b.clientId);
    // Recolecciones aún por hacer en esta sucursal ya no aplican.
    await tx.pickup.updateMany({ where: { branchId: b.id, status: { in: ["SCHEDULED", "BLOCKED"] } }, data: { status: "CANCELLED" } });
    if (b._count.orders === 0 && (await tx.pickup.count({ where: { branchId: b.id, status: { not: "CANCELLED" } } })) === 0) {
      await tx.pickup.deleteMany({ where: { branchId: b.id } });
      await tx.branch.delete({ where: { id: b.id } });
      await audit(tx, { actorUserId, action: "branch.deleted", entity: "Branch", entityId: b.id, summary: `Sucursal ${b.name} borrada` });
      return { ok: true, mode: "deleted" };
    }
    await tx.branch.update({ where: { id: b.id }, data: { active: false, autoPickup: false } });
    await audit(tx, { actorUserId, action: "branch.deactivated", entity: "Branch", entityId: b.id, summary: `Sucursal ${b.name} desactivada (tiene historial)` });
    return { ok: true, mode: "deactivated" };
  });
}

export async function reactivateBranch(prisma: PrismaClient, branchId: string, actorUserId: string): Promise<BranchResult> {
  const b = await prisma.branch.update({ where: { id: branchId }, data: { active: true } });
  await audit(prisma, { actorUserId, action: "branch.reactivated", entity: "Branch", entityId: b.id, summary: `Sucursal ${b.name} reactivada` });
  return { ok: true, mode: "reactivated" };
}
