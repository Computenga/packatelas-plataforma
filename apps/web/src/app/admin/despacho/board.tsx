"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import type { OrderStatus } from "@packatelas/db";
import { STATUS_LABEL } from "@/lib/format";
import { assignAction, unassignAction } from "./actions";

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
};

export const DRIVER_COLORS = ["#2563eb", "#16a34a", "#db2777", "#ea580c", "#7c3aed", "#0891b2", "#ca8a04", "#dc2626", "#4f46e5", "#059669"];

const PENDING: OrderStatus[] = ["CREATED", "RESCHEDULED", "FAILED"];

export function DispatchBoard({ orders, drivers }: { orders: BoardOrder[]; drivers: BoardDriver[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [driverId, setDriverId] = useState<string>(drivers.find((d) => d.onDuty)?.id ?? drivers[0]?.id ?? "");
  const [focusDriver, setFocusDriver] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});
  const [pending, start] = useTransition();

  // Refresco periódico del tablero
  useEffect(() => {
    const id = setInterval(() => router.refresh(), 30_000);
    return () => clearInterval(id);
  }, [router]);

  const colorOf = useMemo(() => new Map(drivers.map((d, i) => [d.id, DRIVER_COLORS[i % DRIVER_COLORS.length]])), [drivers]);
  const unassigned = orders.filter((o) => PENDING.includes(o.status));
  const visible = unassigned.filter((o) => {
    if (!filter) return true;
    const f = filter.toLowerCase();
    return [o.code, o.client, o.recipient, o.address, o.zip].some((v) => v?.toLowerCase().includes(f));
  });
  const byDriver = (id: string) => orders.filter((o) => o.driverId === id && (o.status === "ASSIGNED" || o.status === "OUT_FOR_DELIVERY"));

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const run = (fn: () => Promise<{ ok?: string; error?: string }>) =>
    start(async () => {
      const r = await fn();
      setMsg(r);
      if (r.ok) setSelected(new Set());
      router.refresh();
    });

  const mapOrders = focusDriver ? orders.filter((o) => o.driverId === focusDriver) : orders;

  return (
    <div className="grid gap-4 xl:grid-cols-[380px_1fr_300px]">
      {/* Por asignar */}
      <section className="flex max-h-[78vh] flex-col rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 p-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Por asignar ({unassigned.length})</h2>
            <button
              type="button"
              className="text-xs text-brand"
              onClick={() => setSelected(selected.size ? new Set() : new Set(visible.map((o) => o.id)))}
            >
              {selected.size ? "Quitar selección" : "Seleccionar visibles"}
            </button>
          </div>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filtrar por CP, colonia, cliente…"
            className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
          />
        </div>
        <ul className="flex-1 divide-y divide-slate-100 overflow-auto">
          {visible.map((o) => (
            <li key={o.id}>
              <label className={`flex cursor-pointer gap-3 px-3 py-2 text-sm ${selected.has(o.id) ? "bg-brand/5" : "hover:bg-slate-50"}`}>
                <input type="checkbox" checked={selected.has(o.id)} onChange={() => toggle(o.id)} className="mt-1 accent-brand" />
                <span className="min-w-0">
                  <span className="font-mono text-xs">{o.code}</span>
                  {o.status !== "CREATED" && (
                    <span className="ml-2 rounded bg-amber-50 px-1.5 text-[11px] text-amber-800">
                      {STATUS_LABEL[o.status]}
                      {o.attempts > 0 && ` · ${o.attempts} intento(s)`}
                    </span>
                  )}
                  <span className="block truncate text-slate-700">{o.address}</span>
                  <span className="block truncate text-xs text-slate-500">
                    {o.client}
                    {o.zip && ` · CP ${o.zip}`}
                    {o.lat == null && " · sin ubicación"}
                  </span>
                </span>
              </label>
            </li>
          ))}
          {visible.length === 0 && <li className="p-6 text-center text-sm text-slate-500">Nada por asignar</li>}
        </ul>
        <div className="space-y-2 border-t border-slate-100 p-3">
          <div className="flex gap-2">
            <select
              value={driverId}
              onChange={(e) => setDriverId(e.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2 py-2 text-sm"
              aria-label="Repartidor"
            >
              {drivers.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} {d.onDuty ? "· en turno" : ""} ({byDriver(d.id).length})
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={pending || selected.size === 0 || !driverId}
              onClick={() => run(() => assignAction([...selected], driverId))}
              className="rounded-lg bg-brand px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              Asignar {selected.size || ""}
            </button>
          </div>
          {msg.ok && <p role="status" className="text-xs text-emerald-700">{msg.ok}</p>}
          {msg.error && <p role="alert" className="text-xs text-red-600">{msg.error}</p>}
        </div>
      </section>

      {/* Mapa */}
      <section className="relative min-h-[420px] overflow-hidden rounded-xl border border-slate-200 bg-white xl:h-[78vh]">
        <DispatchMap orders={mapOrders} drivers={drivers} colorOf={colorOf} selected={selected} onToggle={toggle} />
        {focusDriver && (
          <button
            type="button"
            onClick={() => setFocusDriver(null)}
            className="absolute left-3 top-3 rounded-lg bg-white px-3 py-1.5 text-sm shadow"
          >
            Ver todos
          </button>
        )}
      </section>

      {/* Repartidores */}
      <section className="max-h-[78vh] overflow-auto rounded-xl border border-slate-200 bg-white">
        <h2 className="border-b border-slate-100 p-3 font-semibold">Repartidores</h2>
        <ul className="divide-y divide-slate-100">
          {drivers.map((d) => {
            const list = byDriver(d.id);
            const out = list.filter((o) => o.status === "OUT_FOR_DELIVERY").length;
            return (
              <li key={d.id} className="p-3">
                <button type="button" onClick={() => setFocusDriver(d.id === focusDriver ? null : d.id)} className="flex w-full items-center gap-2 text-left">
                  <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: colorOf.get(d.id) }} />
                  <span className="flex-1 truncate text-sm font-medium">{d.name}</span>
                  <span className={`text-xs ${d.onDuty ? "text-emerald-600" : "text-slate-400"}`}>{d.onDuty ? "En turno" : "Fuera"}</span>
                </button>
                <p className="mt-1 pl-5 text-xs text-slate-500">
                  {list.length} en ruta · {out} cargados
                  {d.lastLocationAt && ` · visto ${new Date(d.lastLocationAt).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })}`}
                </p>
                {focusDriver === d.id && list.length > 0 && (
                  <ul className="mt-2 space-y-1 pl-5">
                    {list.map((o) => (
                      <li key={o.id} className="flex items-center justify-between gap-2 text-xs">
                        <Link href={`/admin/pedidos/${o.id}`} className="truncate font-mono text-brand hover:underline">
                          {o.code}
                        </Link>
                        {o.status === "ASSIGNED" ? (
                          <button type="button" className="text-red-600 hover:underline" onClick={() => run(() => unassignAction([o.id]))}>
                            Quitar
                          </button>
                        ) : (
                          <span className="text-slate-500">cargado</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
