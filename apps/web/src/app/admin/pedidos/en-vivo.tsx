import Link from "next/link";
import { mlStatusText, type LiveBucket } from "@packatelas/db";
import { fecha, hace, STATUS_LABEL, STATUS_TONE } from "@/lib/format";
import type { OrderFilters } from "@/lib/order-filters";
import { BUCKETS, liveData, ymdMx } from "./en-vivo-data";
import { Badge, Table, Td } from "@/components/ui";

type Sp = Record<string, string | string[] | undefined>;

/** En vivo: los envíos que estuvieron en la calle en el día, con su avance. */
export async function EnVivo({ f, sp, now }: { f: OrderFilters; sp: Sp; now: number }) {
  const { today, dia, cat, driverId, from, to, rows, list } = await liveData(f, sp, now);
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
          <p className="text-xs uppercase tracking-wide text-slate-500">{dia === today ? "En la calle hoy" : "En la calle ese día"}</p>
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
