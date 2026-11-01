import "server-only";
import { liveBucket, liveOrderIds, prisma, type LiveBucket } from "@packatelas/db";
import { buildWhere, type OrderFilters } from "@/lib/order-filters";

const TZ = "America/Mexico_City";
export const ymdMx = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
export const BUCKETS: { key: LiveBucket; label: string; tone: string }[] = [
  { key: "transito", label: "En tránsito", tone: "text-sky-700" },
  { key: "entregado", label: "Entregados", tone: "text-emerald-700" },
  { key: "fallido", label: "No entregados", tone: "text-red-700" },
  { key: "cancelado", label: "Cancelados", tone: "text-slate-500" },
];
/** Eventos que se muestran como "último movimiento". */
const MOVES = ["assigned", "scanned_loaded", "delivered", "failed", "rescheduled", "return_required", "return_received", "ml_status", "flex_assigned", "flex_transfer", "unassigned"];

type Sp = Record<string, string | string[] | undefined>;
const str = (v: unknown) => (typeof v === "string" ? v : "");

/** Lo que muestra (y exporta) En vivo: los envíos del día con su columna, más los filtros de la vista. */
export async function liveData(f: OrderFilters, sp: Sp, now: number) {
  const today = ymdMx(new Date(now));
  const dia = /^\d{4}-\d{2}-\d{2}$/.test(str(sp.dia)) ? str(sp.dia) : today;
  const cat = BUCKETS.find((b) => b.key === str(sp.cat))?.key;
  const driverId = str(sp.rep);
  const from = new Date(`${dia}T00:00:00-06:00`);
  const to = new Date(from.getTime() + 86_400_000);

  const ids = await liveOrderIds(prisma, from, to);
  const base = buildWhere({ ...f, view: "", status: "", from: "", to: "", page: 1 });
  const orders = await prisma.order.findMany({
    where: { ...base, id: { in: ids } },
    take: 5000,
    include: {
      client: { select: { name: true, publicId: true } },
      driver: { select: { id: true, user: { select: { name: true } } } },
      events: { where: { type: { in: MOVES } }, orderBy: { occurredAt: "desc" }, take: 1, select: { type: true, note: true, occurredAt: true } },
    },
  });
  const rows = orders.map((o) => ({ ...o, bucket: liveBucket(o), last: o.events[0] }));
  const list = rows
    .filter((r) => (!cat || r.bucket === cat) && (!driverId || (r.driver?.id ?? "-") === driverId))
    .sort((a, b) => BUCKETS.findIndex((x) => x.key === a.bucket) - BUCKETS.findIndex((x) => x.key === b.bucket) || (b.last?.occurredAt.getTime() ?? 0) - (a.last?.occurredAt.getTime() ?? 0));
  return { today, dia, cat, driverId, from, to, rows, list };
}
