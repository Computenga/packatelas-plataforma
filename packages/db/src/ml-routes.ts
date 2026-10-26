// Enrutamiento cuenta ML → sucursal(es) [A02]. Una cuenta puede llegar a varias sucursales del
// mismo cliente o de sus subcuentas (cmx00127-granjas, cmx00127-patzcuaro…), que se cobran por
// separado. Al escanear se usa la sucursal indicada en bodega o, si no, la predeterminada.
import type { Prisma, PrismaClient } from "../generated/prisma/client.ts";
import { audit } from "./orders.ts";

type Db = PrismaClient | Prisma.TransactionClient;

/** "cmx00127-granjas" → "cmx00127" */
export const familyBase = (publicId: string) => publicId.toLowerCase().split("-")[0];

/** Sucursales a las que puede llegar la cuenta: las de su cliente y las de sus subcuentas. */
export async function routeOptions(db: Db, mlAccountId: string) {
  const acc = await db.mlAccount.findUniqueOrThrow({ where: { id: mlAccountId }, include: { client: { select: { publicId: true } } } });
  const base = familyBase(acc.client.publicId);
  return db.branch.findMany({
    where: { active: true, client: { OR: [{ publicId: base }, { publicId: { startsWith: `${base}-` } }] } },
    select: { id: true, name: true, address: true, client: { select: { id: true, publicId: true, name: true } } },
    orderBy: [{ client: { publicId: "asc" } }, { name: "asc" }],
  });
}

export type RouteResult = { ok: true } | { ok: false; error: string };

export async function setMlRoutes(
  prisma: PrismaClient,
  mlAccountId: string,
  input: { branchIds: string[]; defaultBranchId: string },
  actorUserId?: string,
): Promise<RouteResult> {
  const ids = [...new Set(input.branchIds)];
  if (!ids.length) return { ok: false, error: "Elige al menos una sucursal" };
  if (!ids.includes(input.defaultBranchId)) return { ok: false, error: "La predeterminada debe estar entre las elegidas" };
  const allowed = new Set((await routeOptions(prisma, mlAccountId)).map((b) => b.id));
  if (ids.some((id) => !allowed.has(id))) return { ok: false, error: "Solo sucursales del cliente o de sus subcuentas" };
  await prisma.$transaction(async (tx) => {
    await tx.mlAccountRoute.deleteMany({ where: { mlAccountId } });
    await tx.mlAccountRoute.createMany({ data: ids.map((branchId) => ({ mlAccountId, branchId, isDefault: branchId === input.defaultBranchId })) });
    const acc = await tx.mlAccount.findUniqueOrThrow({ where: { id: mlAccountId } });
    await audit(tx, { actorUserId, action: "ml_account.routes", entity: "MlAccount", entityId: mlAccountId, summary: `Cuenta ML ${acc.nickname}: ${ids.length} sucursal(es)` });
  });
  return { ok: true };
}

type RouteLike = { branchId: string; isDefault: boolean; branch: { clientId: string } };

/** Sucursal para un paquete escaneado: la indicada en bodega si es de esta cuenta; si no, la predeterminada. */
export function pickRoute<T extends RouteLike>(routes: T[], branchHint?: string | null): T | undefined {
  return (branchHint && routes.find((r) => r.branchId === branchHint)) || routes.find((r) => r.isDefault) || routes[0];
}
