// Pedidos que necesitan atención (vista por defecto de Pedidos en oficina): cada renglón dice por qué.
import type { Prisma, PrismaClient } from "../generated/prisma/client.ts";
import { IN_ROUTE } from "./dispatch.ts";

export const ATTENTION = [
  { key: "sin_asignar", label: "Sin asignar más de 2 h" },
  { key: "intento", label: "2º intento o más" },
  { key: "ml_sin_foto", label: "ML entregado sin foto" },
  { key: "no_visitado", label: "No visitados en ML" },
  { key: "atorado", label: "En ruta más de 24 h" },
] as const;
export type AttentionKey = (typeof ATTENTION)[number]["key"];

const OPEN: Prisma.EnumOrderStatusFilter = { notIn: ["DELIVERED", "CANCELLED", "RETURNED_TO_SELLER"] };

export function attentionWhere(key: AttentionKey, now = new Date()): Prisma.OrderWhereInput {
  const base: Prisma.OrderWhereInput = { kind: { in: ["DELIVERY", "RETURN"] }, source: { not: "IMPORT" } };
  switch (key) {
    case "sin_asignar":
      return { ...base, driverId: null, status: { in: ["CREATED", "RESCHEDULED"] }, updatedAt: { lt: new Date(now.getTime() - 2 * 3600_000) } };
    case "intento":
      return { ...base, attempts: { gte: 1 }, status: { in: ["FAILED", "RESCHEDULED", "RETURNING", "ASSIGNED", "OUT_FOR_DELIVERY"] } };
    case "ml_sin_foto":
      return { ...base, mlStatus: "delivered", status: { in: IN_ROUTE } };
    case "no_visitado":
      return { ...base, status: OPEN, OR: [{ mlStatus: "not_visited" }, { mlSubstatus: "not_visited" }] };
    case "atorado":
      return { ...base, status: { in: IN_ROUTE }, updatedAt: { lt: new Date(now.getTime() - 24 * 3600_000) } };
  }
}

/** Por qué un pedido está en la lista (el primer motivo que aplica, del más grave al más leve). */
export function attentionReason(o: {
  status: string; attempts: number; driverId: string | null; mlStatus: string | null; mlSubstatus: string | null; updatedAt: Date;
}, now = new Date()): string {
  if (o.mlStatus === "not_visited" || o.mlSubstatus === "not_visited") return "ML lo marcó «no visitado»: falta grave";
  if (o.mlStatus === "delivered" && IN_ROUTE.includes(o.status as never)) return "ML lo marcó entregado y falta la foto";
  if (o.attempts >= 1) return `${o.attempts + 1}º intento${o.status === "FAILED" ? ": falló el último" : ""}`;
  const h = Math.floor((now.getTime() - o.updatedAt.getTime()) / 3600_000);
  const t = h >= 48 ? `${Math.floor(h / 24)} días` : `${h} h`;
  if (!o.driverId) return `Sin asignar desde hace ${t}`;
  return `En ruta sin movimiento desde hace ${t}`;
}

export async function attentionCounts(prisma: PrismaClient, now = new Date()) {
  const counts = await Promise.all(ATTENTION.map((a) => prisma.order.count({ where: attentionWhere(a.key, now) })));
  const all = await prisma.order.count({ where: { OR: ATTENTION.map((a) => attentionWhere(a.key, now)) } });
  return { all, by: Object.fromEntries(ATTENTION.map((a, i) => [a.key, counts[i]])) as Record<AttentionKey, number> };
}
