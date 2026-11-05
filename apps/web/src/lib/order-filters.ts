import type { OrderStatus, Prisma } from "@packatelas/db";
import { STATUS_LABEL } from "./format";

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
  if (f.view === "vivo") {
    where.status = { in: LIVE_STATUSES };
    where.source = { not: "IMPORT" }; // el historial migrado no es operación en curso
  }
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
    const q = f.q.trim();
    // Un código completo (PK-000123, ML-48323149259, DV-00001) se busca directo, sin recorrer textos.
    if (/^(PK|ML|PF|RC|DV)-\d+$/i.test(q)) {
      where.code = q.toUpperCase();
      return where;
    }
    // Cada palabra debe aparecer en algún campo («del valle juan» = colonia Del Valle y repartidor Juan).
    const terms = q.split(/\s+/).filter(Boolean).slice(0, 6);
    where.AND = terms.map((t) => ({ OR: termMatch(t) }));
  }
  return where;
}

const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/** Campos donde busca una palabra: folios, venta/envío/paquete ML, dirección, persona, tienda, repartidor y estado. */
function termMatch(t: string): Prisma.OrderWhereInput[] {
  const text = { contains: t, mode: "insensitive" as const };
  const digits = t.replace(/\D/g, "");
  const n = norm(t);
  const statuses = (Object.keys(STATUS_LABEL) as OrderStatus[]).filter((k) => n.length >= 3 && norm(STATUS_LABEL[k]).includes(n));
  return [
    { code: text },
    { externalRef: text },
    { recipientName: text },
    { recipientPhone: { contains: t } },
    { addressLine: text },
    { neighborhood: text },
    { city: text },
    { state: text },
    { zip: { startsWith: t } },
    { instructions: text },
    { itemsSummary: text },
    { client: { name: text } },
    { client: { publicId: { contains: t.toLowerCase() } } },
    { driver: { user: { name: text } } },
    ...(statuses.length ? [{ status: { in: statuses } }] : []),
    ...(digits.length >= 8 && digits.length <= 18 && digits === t ? [{ mlShipmentId: BigInt(digits) }, { mlOrderId: BigInt(digits) }, { mlPackId: BigInt(digits) }] : []),
  ];
}

export function filtersToQuery(f: OrderFilters, page = f.page) {
  const p = new URLSearchParams();
  if (f.view) p.set("vista", f.view);
  for (const k of ["q", "status", "clientId", "from", "to"] as const) if (f[k]) p.set(k, f[k]);
  if (page > 1) p.set("page", String(page));
  return p.toString();
}
