import type { OrderStatus, Prisma } from "@packatelas/db";

export const PAGE_SIZE = 50;
const STATUSES = new Set<OrderStatus>([
  "CREATED", "ASSIGNED", "OUT_FOR_DELIVERY", "DELIVERED", "FAILED",
  "RESCHEDULED", "RETURNING", "RETURNED_TO_WAREHOUSE", "RETURNED_TO_SELLER", "CANCELLED",
]);

export type OrderView = "" | "vivo" | "recuperados";
export type OrderFilters = { q: string; status: string; clientId: string; from: string; to: string; page: number; view: OrderView };

/** Pedidos que siguen en la calle o en la bodega sin cerrar. */
export const LIVE_STATUSES: OrderStatus[] = ["CREATED", "ASSIGNED", "OUT_FOR_DELIVERY", "FAILED", "RESCHEDULED", "RETURNING"];

export function readFilters(sp: Record<string, string | string[] | undefined>): OrderFilters {
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string).trim() : "");
  const view = (["vivo", "recuperados"] as const).find((v) => v === s("vista")) ?? "";
  return { q: s("q"), status: s("status"), clientId: s("clientId"), from: s("from"), to: s("to"), page: Math.max(1, Number(s("page")) || 1), view };
}

/** Filtros de trazabilidad [A09]: búsqueda libre, estado, cliente y rango de fechas (hora CDMX). */
export function buildWhere(f: OrderFilters, restrictClientId?: string): Prisma.OrderWhereInput {
  const where: Prisma.OrderWhereInput = {};
  if (restrictClientId) where.clientId = restrictClientId;
  else if (f.clientId) where.clientId = f.clientId;
  if (f.view === "vivo") where.status = { in: LIVE_STATUSES };
  if (STATUSES.has(f.status as OrderStatus) && (!f.view || (f.view === "vivo" && LIVE_STATUSES.includes(f.status as OrderStatus)))) {
    where.status = f.status as OrderStatus;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(f.from) || /^\d{4}-\d{2}-\d{2}$/.test(f.to)) {
    where.createdAt = {
      ...(f.from ? { gte: new Date(`${f.from}T00:00:00-06:00`) } : {}),
      ...(f.to ? { lt: new Date(new Date(`${f.to}T00:00:00-06:00`).getTime() + 86_400_000) } : {}),
    };
  }
  if (f.q) {
    const digits = f.q.replace(/\D/g, "");
    // Un código completo (PK-000123, ML-48323149259) se busca directo, sin recorrer textos.
    if (/^(PK|ML|PF|RC)-\d+$/i.test(f.q.trim())) {
      where.code = f.q.trim().toUpperCase();
      return where;
    }
    where.OR = [
      { code: { contains: f.q, mode: "insensitive" } },
      { recipientName: { contains: f.q, mode: "insensitive" } },
      { addressLine: { contains: f.q, mode: "insensitive" } },
      { neighborhood: { contains: f.q, mode: "insensitive" } },
      { zip: { startsWith: f.q } },
      ...(digits.length >= 10 && digits.length <= 15 ? [{ mlShipmentId: BigInt(digits) }, { mlOrderId: BigInt(digits) }] : []),
    ];
  }
  return where;
}

export function filtersToQuery(f: OrderFilters, page = f.page) {
  const p = new URLSearchParams();
  if (f.view) p.set("vista", f.view);
  for (const k of ["q", "status", "clientId", "from", "to"] as const) if (f[k]) p.set(k, f[k]);
  if (page > 1) p.set("page", String(page));
  return p.toString();
}
