import Link from "next/link";
import { liveBucket, liveOrderIds, mlStatusText, prisma, type LiveBucket } from "@packatelas/db";
import { fecha, hace, STATUS_LABEL, STATUS_TONE } from "@/lib/format";
import { buildWhere, type OrderFilters } from "@/lib/order-filters";
import { Badge, Table, Td } from "@/components/ui";

const TZ = "America/Mexico_City";
const ymdMx = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
const BUCKETS: { key: LiveBucket; label: string; tone: string }[] = [
  { key: "transito", label: "En tránsito", tone: "text-sky-700" },
  { key: "entregado", label: "Entregados", tone: "text-emerald-700" },
  { key: "fallido", label: "No entregados", tone: "text-red-700" },
  { key: "cancelado", label: "Cancelados", tone: "text-slate-500" },
];
/** Eventos que se muestran como "último movimiento". */
const MOVES = ["assigned", "scanned_loaded", "delivered", "failed", "rescheduled", "return_required", "return_received", "ml_status", "flex_assigned", "flex_transfer", "unassigned"];

type Sp = Record<string, string | string[] | undefined>;
const str = (v: unknown) => (typeof v === "string" ? v : "");

/** En vivo: los envíos que estuvieron en la calle en el día, con su avance. */
export async function EnVivo({ f, sp, now }: { f: OrderFilters; sp: Sp; now: number }) {
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
    take: 2000,
    include: {
      client: { select: { name: true } },
      driver: { select: { id: true, user: { select: { name: true } } } },
      events: { where: { type: { in: MOVES } }, orderBy: { occurredAt: "desc" }, take: 1, select: { type: true, note: true, occurredAt: true } },
    },
  });
  const rows = orders.map((o) => ({ ...o, bucket: liveBucket(o), last: o.events[0] }));
  const count = (b: LiveBucket, list = rows) => list.filter((r) => r.bucket === b).length;
  const closed = count("entregado") + count("fallido");

  // Por repartidor
  const byDriver = new Map<string, { id: string; name: string; rows: typeof rows }>();
  for (const r of rows) {
    const k = r.driver?.id ?? "";
    const e = byDriver.get(k) ?? { id: k, name: r.driver?.user.name ?? "Sin repartidor", rows: [] };
    e.rows.push(r);
    byDriver.set(k, e);
  }
  const drivers = [...byDriver.values()].sort((a, b) => count("transito", b.rows) - count("transito", a.rows) || b.rows.length - a.rows.length);

  const list = rows
    .filter((r) => (!cat || r.bucket === cat) && (!driverId || (r.driver?.id ?? "-") === driverId))
    .sort((a, b) => BUCKETS.findIndex((x) => x.key === a.bucket) - BUCKETS.findIndex((x) => x.key === b.bucket) || (b.last?.occurredAt.getTime() ?? 0) - (a.last?.occurredAt.getTime() ?? 0));

  const href = (p: Record<string, string | undefined>) => {
    const q = new URLSearchParams({ vista: "vivo" });
    const merged = { dia: dia === today ? undefined : dia, cat, rep: driverId || undefined, q: f.q || undefined, clientId: f.clientId || undefined, ...p };
    for (const [k, v] of Object.entries(merged)) if (v) q.set(k, v);
    return `/admin/pedidos?${q}`;
  };
  const prevDay = ymdMx(new Date(from.getTime() - 12 * 3600_000));
  const nextDay = ymdMx(new Date(to.getTime() + 12 * 3600_000));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Link href={href({ dia: prevDay === today ? undefined : prevDay })} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5">← Día anterior</Link>
        <form className="flex gap-2">
          <input type="hidden" name="vista" value="vivo" />
          <input type="date" name="dia" defaultValue={dia} max={today} className="rounded-lg border border-slate-300 px-2 py-1.5" aria-label="Día" />
          <button className="rounded-lg bg-brand px-3 text-white">Ver</button>
        </form>
        {dia < today && <Link href={href({ dia: nextDay >= today ? undefined : nextDay })} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5">Día siguiente →</Link>}
        {dia !== today && <Link href={href({ dia: undefined })} className="text-brand">Hoy</Link>}
        <span className="text-xs text-slate-500">{dia === today ? "Se actualiza cada minuto" : `Día ${dia}`}</span>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <Link href={href({ cat: undefined })} className={`rounded-xl border bg-white p-3 ${!cat ? "border-brand ring-1 ring-brand" : "border-slate-200"}`}>
          <p className="text-xs uppercase tracking-wide text-slate-500">En la calle hoy</p>
          <p className="text-2xl font-bold tabular-nums">{rows.length}</p>
          <p className="text-xs text-slate-500">{closed ? `Efectividad ${Math.round((count("entregado") / closed) * 100)}%` : "Sin cierres aún"}</p>
        </Link>
        {BUCKETS.map((b) => (
          <Link key={b.key} href={href({ cat: cat === b.key ? undefined : b.key })} className={`rounded-xl border bg-white p-3 ${cat === b.key ? "border-brand ring-1 ring-brand" : "border-slate-200"}`}>
            <p className="text-xs uppercase tracking-wide text-slate-500">{b.label}</p>
            <p className={`text-2xl font-bold tabular-nums ${b.tone}`}>{count(b.key)}</p>
          </Link>
        ))}
      </div>

      {drivers.length > 0 && (
        <Table head={["Repartidor", "En tránsito", "Entregados", "No entregados", "Total"]}>
          {drivers.map((d) => (
            <tr key={d.id || "none"} className={driverId === (d.id || "-") ? "bg-brand/5" : "hover:bg-slate-50"}>
              <Td>
                <Link href={href({ rep: driverId === (d.id || "-") ? undefined : d.id || "-" })} className="font-medium text-brand hover:underline">{d.name}</Link>
              </Td>
              <Td className="font-semibold tabular-nums text-sky-700">{count("transito", d.rows)}</Td>
              <Td className="tabular-nums text-emerald-700">{count("entregado", d.rows)}</Td>
              <Td className="tabular-nums text-red-700">{count("fallido", d.rows)}</Td>
              <Td className="tabular-nums">{d.rows.length}</Td>
            </tr>
          ))}
        </Table>
      )}

      <Table head={["Envío", "Estado", "Último movimiento", "Repartidor", "Cliente", "Dirección"]} empty={list.length ? undefined : "Sin envíos para este día con estos filtros"}>
        {list.map((o) => (
          <tr key={o.id} className="align-top hover:bg-slate-50">
            <Td>
              <Link href={`/admin/pedidos/${o.id}`} className="font-mono text-xs font-medium text-brand hover:underline">{o.code}</Link>
              <span className="block text-[11px] text-slate-400">{o.mlShipmentId ? "Mercado Libre" : "Externo"}</span>
            </Td>
            <Td>
              <Badge tone={STATUS_TONE[o.status]}>{STATUS_LABEL[o.status]}</Badge>
              {o.mlStatus && <span className="mt-0.5 block text-[11px] text-slate-500">ML: {mlStatusText(o.mlStatus, o.mlSubstatus)}</span>}
            </Td>
            <Td className="text-xs text-slate-600">
              {o.last ? (
                <span title={fecha(o.last.occurredAt)}>
                  hace {hace(o.last.occurredAt, now)}
                  {o.last.note ? ` · ${o.last.note}` : ""}
                </span>
              ) : (
                "—"
              )}
            </Td>
            <Td>{o.driver?.user.name ?? "—"}</Td>
            <Td className="max-w-[12rem] truncate">{o.client.name}</Td>
            <Td className="max-w-xs truncate">{[o.addressLine, o.neighborhood, o.city].filter(Boolean).join(", ")}</Td>
          </tr>
        ))}
      </Table>
    </div>
  );
}
