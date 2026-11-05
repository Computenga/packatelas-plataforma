"use client";

// Despacho al estilo Onfleet: a la izquierda lo sin asignar (agrupado por zona) y debajo cada
// repartidor con su avance; a la derecha el mapa o, para mucho volumen, la tabla.
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import type { OrderStatus } from "@packatelas/db";
import { STATUS_LABEL } from "@/lib/format";
import { assignAction, unassignAction } from "./actions";
import { bulkFailureAction } from "../pedidos/actions";

const DispatchMap = dynamic(() => import("./dispatch-map").then((m) => m.DispatchMap), {
  ssr: false,
  loading: () => <div className="h-full min-h-[420px] animate-pulse rounded-xl bg-slate-100" />,
});

export type BoardOrder = {
  id: string;
  code: string;
  status: OrderStatus;
  client: string;
  recipient: string | null;
  address: string;
  neighborhood: string | null;
  city: string | null;
  zip: string | null;
  lat: number | null;
  lng: number | null;
  driverId: string | null;
  attempts: number;
};
export type BoardDriver = {
  id: string;
  name: string;
  onDuty: boolean;
  lat: number | null;
  lng: number | null;
  lastLocationAt: string | null;
  deliveredToday: number;
};

export const DRIVER_COLORS = ["#2563eb", "#16a34a", "#db2777", "#ea580c", "#7c3aed", "#0891b2", "#ca8a04", "#dc2626", "#4f46e5", "#059669"];

const PENDING: OrderStatus[] = ["CREATED", "RESCHEDULED", "FAILED"];
/** Sin ubicación por más de esto y en turno: se marca «sin señal». */
const SILENT_MS = 10 * 60_000;

const initials = (n: string) => n.split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
const zoneOf = (o: BoardOrder) => o.neighborhood?.trim() || (o.zip ? `CP ${o.zip}` : o.city?.trim() || "Sin colonia");
const ago = (min: number) => (min >= 90 ? `${Math.round(min / 60)} h` : `${min} min`);

export function DispatchBoard({ orders, drivers }: { orders: BoardOrder[]; drivers: BoardDriver[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [driverId, setDriverId] = useState<string>(drivers.find((d) => d.onDuty)?.id ?? drivers[0]?.id ?? "");
  const [focusDriver, setFocusDriver] = useState<string | null>(null);
  const [openZone, setOpenZone] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [mode, setMode] = useState<"mapa" | "tabla">("mapa");
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});
  const [pending, start] = useTransition();
  const [now, setNow] = useState(() => Date.now());

  // Refresco periódico del tablero (y del reloj para «sin señal»).
  useEffect(() => {
    const id = setInterval(() => {
      router.refresh();
      setNow(Date.now());
    }, 30_000);
    return () => clearInterval(id);
  }, [router]);

  const colorOf = useMemo(() => new Map(drivers.map((d, i) => [d.id, DRIVER_COLORS[i % DRIVER_COLORS.length]])), [drivers]);
  const unassigned = orders.filter((o) => PENDING.includes(o.status));
  const visible = unassigned.filter((o) => {
    if (!filter) return true;
    const f = filter.toLowerCase();
    return [o.code, o.client, o.recipient, o.address, o.zip].some((v) => v?.toLowerCase().includes(f));
  });
  const zoneMap = new Map<string, BoardOrder[]>();
  for (const o of visible) zoneMap.set(zoneOf(o), [...(zoneMap.get(zoneOf(o)) ?? []), o]);
  const zones = [...zoneMap.entries()]
    .map(([name, list]) => ({ name, list, zips: [...new Set(list.map((o) => o.zip).filter(Boolean))] }))
    .sort((a, b) => b.list.length - a.list.length);
  const byDriver = (id: string) => orders.filter((o) => o.driverId === id && (o.status === "ASSIGNED" || o.status === "OUT_FOR_DELIVERY"));
  const toWarehouse = (id: string) => orders.filter((o) => o.driverId === id && (o.status === "RETURNING" || o.status === "FAILED"));
  const selectedFailed = unassigned.filter((o) => selected.has(o.id) && o.status !== "CREATED").length;

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const toggleMany = (ids: string[]) =>
    setSelected((s) => {
      const all = ids.every((i) => s.has(i));
      const n = new Set(s);
      for (const i of ids) {
        if (all) n.delete(i);
        else n.add(i);
      }
      return n;
    });

  const run = (fn: () => Promise<{ ok?: string; error?: string }>) =>
    start(async () => {
      const r = await fn();
      setMsg(r);
      if (r.ok) setSelected(new Set());
      router.refresh();
    });

  const onStreet = orders.filter((o) => o.status !== "RETURNING");
  const mapOrders = focusDriver ? onStreet.filter((o) => o.driverId === focusDriver) : onStreet;
  const duty = drivers.filter((d) => d.onDuty);
  const off = drivers.filter((d) => !d.onDuty);

  const driverRow = (d: BoardDriver) => {
    const list = byDriver(d.id);
    const total = list.length + d.deliveredToday;
    const pct = total ? Math.round((d.deliveredToday / total) * 100) : 0;
    const silent = d.onDuty && (!d.lastLocationAt || now - new Date(d.lastLocationAt).getTime() > SILENT_MS);
    const mins = d.lastLocationAt ? Math.round((now - new Date(d.lastLocationAt).getTime()) / 60_000) : null;
    return (
      <li key={d.id} className="px-3 py-2.5">
        <button type="button" onClick={() => setFocusDriver(d.id === focusDriver ? null : d.id)} className="flex w-full items-center gap-2.5 text-left">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white" style={{ background: colorOf.get(d.id) }}>{initials(d.name)}</span>
          <span className="min-w-0 flex-1">
            <span className="flex items-baseline justify-between gap-2">
              <b className="truncate text-sm">{d.name}</b>
              <span className="shrink-0 text-xs text-slate-500 tabular-nums">{d.deliveredToday} de {total}</span>
            </span>
            {d.onDuty && (
              <span className="mt-1 block h-1.5 rounded-full bg-slate-100">
                <span className="block h-1.5 rounded-full" style={{ width: `${pct}%`, background: silent ? "#b45309" : "#168A4D" }} />
              </span>
            )}
            <span className="mt-0.5 block text-xs text-slate-500">
              {silent ? <span className="font-semibold text-red-600">Sin señal{mins != null ? ` hace ${ago(mins)}` : ""}</span> : d.onDuty ? `Visto hace ${mins != null ? ago(mins) : "?"}` : "Fuera de turno"}
              {toWarehouse(d.id).length > 0 && <span className="text-amber-700"> · {toWarehouse(d.id).length} para bodega</span>}
            </span>
          </span>
        </button>
        {focusDriver === d.id && list.length > 0 && (
          <ul className="mt-2 space-y-1 pl-10">
            {list.map((o, i) => (
              <li key={o.id} className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate"><span className="text-slate-400">{i + 1}.</span> <Link href={`/admin/pedidos/${o.id}`} className="font-semibold tabular-nums hover:underline">{o.code}</Link> <span className="text-slate-500">{o.neighborhood ?? ""}</span></span>
                {o.status === "ASSIGNED" ? (
                  <button type="button" className="text-red-600 hover:underline" onClick={() => run(() => unassignAction([o.id]))}>Quitar</button>
                ) : (
                  <span className="text-slate-500">cargado</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </li>
    );
  };

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[400px_1fr] [&>*]:min-w-0">
      <section className="flex max-h-[80vh] flex-col overflow-hidden rounded-xl bg-white">
        <div className="space-y-2 border-b border-slate-100 p-3">
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Buscar folio, CP, colonia o tienda" className="w-full rounded-lg border-[1.5px] border-slate-200 px-3 py-2 text-sm" />
        </div>
        <div className="flex-1 overflow-auto">
          <div className="flex items-center justify-between bg-slate-50 px-3 py-2 text-sm font-bold">
            <span>Sin asignar · {unassigned.length}</span>
            <button type="button" className="text-xs font-semibold text-slate-500" onClick={() => setSelected(selected.size ? new Set() : new Set(visible.map((o) => o.id)))}>
              {selected.size ? "Quitar selección" : "Seleccionar todo"}
            </button>
          </div>
          <ul className="divide-y divide-slate-100">
            {zones.map((z) => {
              const ids = z.list.map((o) => o.id);
              const n = ids.filter((i) => selected.has(i)).length;
              const retry = z.list.filter((o) => o.attempts > 0 || o.status !== "CREATED").length;
              return (
                <li key={z.name}>
                  <div className={`flex items-center gap-3 px-3 py-2.5 ${n ? "bg-amber-50/70" : ""}`}>
                    <input type="checkbox" aria-label={`Seleccionar ${z.name}`} checked={n === ids.length} ref={(el) => { if (el) el.indeterminate = n > 0 && n < ids.length; }} onChange={() => toggleMany(ids)} className="h-4 w-4 accent-brand" />
                    <button type="button" onClick={() => setOpenZone(openZone === z.name ? null : z.name)} className="min-w-0 flex-1 text-left">
                      <span className="block text-sm"><b>{z.name}</b> <span className="text-slate-500">{z.list.length} paquete(s)</span></span>
                      {z.zips.length > 0 && <span className="block truncate text-xs text-slate-500">CP {z.zips.join(", ")}</span>}
                    </button>
                    {retry > 0 && <span className="rounded-md bg-[#FDE7EA] px-1.5 py-0.5 text-[11px] font-bold text-[#C21F35]">{retry} reintento(s)</span>}
                  </div>
                  {openZone === z.name && (
                    <ul className="bg-slate-50/60 pb-1">
                      {z.list.map((o) => (
                        <li key={o.id}>
                          <label className="flex cursor-pointer gap-3 py-1.5 pr-3 pl-10 text-sm">
                            <input type="checkbox" checked={selected.has(o.id)} onChange={() => toggle(o.id)} className="mt-1 accent-brand" />
                            <span className="min-w-0">
                              <b className="tabular-nums">{o.code}</b>
                              {o.status !== "CREATED" && <span className="ml-2 text-[11px] font-semibold text-amber-800">{STATUS_LABEL[o.status]}{o.attempts > 0 && ` · ${o.attempts} intento(s)`}</span>}
                              <span className="block truncate text-xs text-slate-600">{o.address}</span>
                              <span className="block truncate text-xs text-slate-500">{o.client}{o.lat == null && " · sin ubicación en el mapa"}</span>
                            </span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
            {zones.length === 0 && <li className="p-6 text-center text-sm text-slate-500">Nada por asignar</li>}
          </ul>

          <div className="mt-2 flex items-center justify-between bg-slate-50 px-3 py-2 text-sm font-bold">
            <span>Repartidores en turno · {duty.length}</span>
            <span className="text-xs font-semibold text-slate-500">Entregados hoy</span>
          </div>
          <ul className="divide-y divide-slate-100">{duty.map(driverRow)}</ul>
          {off.length > 0 && (
            <details>
              <summary className="cursor-pointer bg-slate-50 px-3 py-2 text-sm font-bold text-slate-500">Fuera de turno · {off.length}</summary>
              <ul className="divide-y divide-slate-100">{off.map(driverRow)}</ul>
            </details>
          )}
        </div>

        {/* Barra para asignar lo seleccionado */}
        <div className={`space-y-2 p-3 ${selected.size ? "bg-brand text-white" : "border-t border-slate-100"}`}>
          <div className="flex items-center gap-2">
            <span className="shrink-0 text-sm font-semibold">{selected.size ? `${selected.size} seleccionado(s)` : "Selecciona una zona"}</span>
            <select value={driverId} onChange={(e) => setDriverId(e.target.value)} className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm text-brand" aria-label="Repartidor">
              {drivers.map((d) => (
                <option key={d.id} value={d.id}>{d.name}{d.onDuty ? "" : " (fuera)"} · {byDriver(d.id).length} en ruta</option>
              ))}
            </select>
            <button type="button" disabled={pending || selected.size === 0 || !driverId} onClick={() => run(() => assignAction([...selected], driverId))} className="rounded-lg bg-accent px-3 py-2 text-sm font-bold text-brand disabled:opacity-40">
              Asignar
            </button>
          </div>
          {selectedFailed > 0 && (
            <div className="flex gap-2 text-xs">
              <button type="button" disabled={pending} onClick={() => run(() => bulkFailureAction([...selected], "warehouse"))} className="flex-1 rounded-lg border border-amber-300 bg-amber-50 px-2 py-1.5 font-semibold text-amber-900 disabled:opacity-50">
                Regresar a bodega ({selectedFailed})
              </button>
              <button type="button" disabled={pending} onClick={() => run(() => bulkFailureAction([...selected], "reschedule"))} className="flex-1 rounded-lg border border-slate-300 bg-white px-2 py-1.5 font-semibold text-slate-700 disabled:opacity-50">
                Reprogramar
              </button>
            </div>
          )}
          {msg.ok && <p role="status" className={`text-xs ${selected.size ? "text-emerald-300" : "text-emerald-700"}`}>{msg.ok}</p>}
          {msg.error && <p role="alert" className="text-xs text-red-500">{msg.error}</p>}
        </div>
      </section>

      <section className="relative min-h-[420px] overflow-hidden rounded-xl bg-white xl:h-[80vh]">
        <div className="absolute top-3 left-3 z-[500] flex rounded-lg bg-white p-0.5 text-sm font-bold shadow">
          {(["mapa", "tabla"] as const).map((m) => (
            <button key={m} type="button" onClick={() => setMode(m)} className={`rounded-md px-3 py-1.5 ${mode === m ? "bg-brand text-white" : "text-slate-600"}`}>
              {m === "mapa" ? "Mapa" : "Tabla"}
            </button>
          ))}
        </div>
        {mode === "mapa" ? (
          <>
            <DispatchMap orders={mapOrders} drivers={drivers} colorOf={colorOf} selected={selected} onToggle={toggle} />
            {focusDriver && (
              <button type="button" onClick={() => setFocusDriver(null)} className="absolute top-3 right-3 z-[500] rounded-lg bg-white px-3 py-1.5 text-sm font-semibold shadow">
                Ver todos
              </button>
            )}
          </>
        ) : (
          <div className="h-full overflow-auto pt-14">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-white text-[13px] text-slate-500">
                <tr>
                  <th className="w-10 px-3 py-2"><input type="checkbox" aria-label="Seleccionar todos" checked={visible.length > 0 && visible.every((o) => selected.has(o.id))} onChange={() => toggleMany(visible.map((o) => o.id))} className="h-4 w-4 accent-brand" /></th>
                  {["Folio", "Zona", "Dirección", "Tienda", "Estado"].map((h) => <th key={h} className="px-3 font-semibold">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {visible.map((o) => (
                  <tr key={o.id} className={`border-t border-slate-100 ${selected.has(o.id) ? "bg-amber-50/70" : ""}`}>
                    <td className="px-3 py-2"><input type="checkbox" checked={selected.has(o.id)} onChange={() => toggle(o.id)} className="h-4 w-4 accent-brand" /></td>
                    <td className="px-3 font-bold tabular-nums">{o.code}</td>
                    <td className="px-3">{zoneOf(o)}</td>
                    <td className="max-w-xs truncate px-3">{o.address}</td>
                    <td className="px-3">{o.client}</td>
                    <td className="px-3">{STATUS_LABEL[o.status]}{o.attempts > 0 && ` · ${o.attempts} intento(s)`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
