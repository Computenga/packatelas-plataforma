"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, useTransition } from "react";
import type { ReturnCandidate } from "@packatelas/db";
import { Scanner } from "@/components/scanner";
import { AssignSelect } from "../../pedidos/assign-select";
import { branchesAction, candidateAction, createReturnAction, searchAction } from "./actions";

type Branch = { id: string; name: string; address: string };

/** Arma una orden de devolución: escáner/PDA, cámara o búsqueda en el histórico. */
export function ReturnBuilder({ initial, drivers = [] }: { initial: ReturnCandidate[]; drivers?: { id: string; name: string; onDuty: boolean }[] }) {
  const [items, setItems] = useState<ReturnCandidate[]>(initial);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<ReturnCandidate[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState("");
  const [note, setNote] = useState("");
  const [created, setCreated] = useState<{ id: string; code: string } | null>(null);
  const [pending, start] = useTransition();
  const clientId = items[0]?.clientId;

  useEffect(() => {
    if (!clientId) return;
    let live = true;
    branchesAction(clientId).then((b) => { if (live) { setBranches(b); setBranchId((cur) => (b.some((x) => x.id === cur) ? cur : "")); } });
    return () => { live = false; };
  }, [clientId]);

  const add = useCallback((it: ReturnCandidate) => {
    setItems((cur) => {
      if (cur.some((x) => x.id === it.id)) { setMsg({ tone: "err", text: `${it.code} ya está en la lista` }); return cur; }
      if (cur[0] && cur[0].clientId !== it.clientId) { setMsg({ tone: "err", text: `${it.code} es de ${it.clientName}; esta devolución es para ${cur[0].clientName}` }); navigator.vibrate?.([80, 60, 80]); return cur; }
      setMsg({ tone: "ok", text: `${it.code} agregado (${it.clientName})` });
      navigator.vibrate?.(60);
      return [...cur, it];
    });
  }, []);

  const onScan = useCallback((raw: string) => start(async () => {
    const r = await candidateAction({ raw }).catch(() => ({ ok: false as const, error: "Sin conexión; vuelve a escanear" }));
    if (r.ok) add(r.item); else { setMsg({ tone: "err", text: r.error }); navigator.vibrate?.([80, 60, 80]); }
  }), [add]);

  const search = () => start(async () => setResults(await searchAction(q, clientId)));
  const create = () => start(async () => {
    const r = await createReturnAction(items.map((i) => i.id), branchId, note);
    if (r.error) setMsg({ tone: "err", text: r.error });
    else { setCreated({ id: r.id!, code: r.code! }); setItems([]); setResults([]); }
  });

  if (created) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-sm">
        <p className="text-lg font-bold text-emerald-800">Orden de devolución {created.code} creada</p>
        <p className="mt-1">Al entregarla, sus paquetes quedan «Devuelto al vendedor».</p>
        {drivers.length > 0 ? (
          <p className="mt-3 flex flex-wrap items-center gap-2"><span className="font-medium">Asignar a:</span> <AssignSelect orderId={created.id} current={null} drivers={drivers} /></p>
        ) : (
          <p className="mt-1">El despacho la asigna a un repartidor desde Devoluciones o Despacho.</p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <Link href={`/admin/pedidos/${created.id}`} className="rounded-lg bg-brand px-4 py-2 font-semibold text-white">Ver orden</Link>
          <Link href={`/etiqueta/${created.id}`} target="_blank" className="rounded-lg border border-slate-300 bg-white px-4 py-2">Imprimir etiqueta</Link>
          <Link href="/admin/despacho" className="rounded-lg border border-slate-300 bg-white px-4 py-2">Ir a Despacho</Link>
          <button onClick={() => setCreated(null)} className="rounded-lg border border-slate-300 bg-white px-4 py-2">Crear otra</button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,420px)_1fr]">
      <div className="space-y-4">
        <div>
          <p className="mb-2 text-sm font-medium">Escanea con el lector/PDA o con la cámara</p>
          <Scanner onScan={onScan} busy={pending} />
        </div>
        <div>
          <p className="mb-2 text-sm font-medium">o búscalos en el histórico</p>
          <div className="flex gap-2">
            <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()} placeholder="Código, tienda o destinatario" className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            <button onClick={search} disabled={pending} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">Buscar</button>
          </div>
          {clientId && <p className="mt-1 text-xs text-slate-500">Mostrando solo paquetes de {items[0].clientName}.</p>}
          {results.length > 0 && (
            <ul className="mt-2 max-h-72 divide-y divide-slate-100 overflow-auto rounded-lg border border-slate-200 bg-white text-sm">
              {results.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2 px-3 py-1.5">
                  <span className="min-w-0"><span className="font-mono text-xs">{r.code}</span> · {r.clientName} <span className="text-xs text-slate-500">· {r.reopened ? "marcado devuelto sin DV" : r.inWarehouse ? "en bodega" : "por recibir"}</span></span>
                  <button onClick={() => add(r)} disabled={items.some((x) => x.id === r.id)} className="text-xs font-semibold text-brand disabled:text-slate-400">{items.some((x) => x.id === r.id) ? "Agregado" : "Agregar"}</button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {msg && <p className={`rounded-lg px-3 py-2 text-sm ${msg.tone === "ok" ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}>{msg.text}</p>}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="font-semibold">{items.length ? `Devolución para ${items[0].clientName} · ${items.length} paquete(s)` : "Aún no hay paquetes"}</p>
        <ul className="mt-2 divide-y divide-slate-100 text-sm">
          {items.map((i) => (
            <li key={i.id} className="flex items-center justify-between py-1.5">
              <span><span className="font-mono text-xs">{i.code}</span> <span className="text-xs text-slate-500">· {i.reopened ? "estaba marcado devuelto sin DV: regresa a bodega" : i.inWarehouse ? "en bodega" : "se marcará recibido en bodega"}</span></span>
              <button onClick={() => setItems((c) => c.filter((x) => x.id !== i.id))} className="text-xs text-red-600">Quitar</button>
            </li>
          ))}
        </ul>
        {items.length > 0 && (
          <div className="mt-4 space-y-3 border-t border-slate-100 pt-3">
            <label className="block text-sm">Entregar en
              <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2">
                <option value="">Sucursal de la mayoría de los paquetes</option>
                {branches.filter(() => !!clientId).map((b) => <option key={b.id} value={b.id}>{b.name} · {b.address.slice(0, 60)}</option>)}
              </select>
            </label>
            <label className="block text-sm">Nota para el repartidor (opcional)
              <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
            </label>
            <button onClick={create} disabled={pending} className="w-full rounded-xl bg-brand py-3 font-semibold text-white disabled:opacity-50">{pending ? "Creando…" : `Crear devolución (${items.length})`}</button>
          </div>
        )}
      </div>
    </div>
  );
}
