"use client";

import { useCallback, useState, useTransition } from "react";
import type { FlexLookup } from "@packatelas/db";
import { Scanner } from "@/components/scanner";
import { diagnoseFlexAction, linkFlexAction, lookupFlexAction } from "./actions";

type Driver = { id: string; name: string; username: string };

export function FlexLinkPanel({ drivers }: { drivers: Driver[] }) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState<FlexLookup | null>(null);
  const [sel, setSel] = useState("");
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});
  const [busy, start] = useTransition();
  const [showScanner, setShowScanner] = useState(false);
  const [diag, setDiag] = useState("");

  const search = useCallback((raw: string) => {
    setMsg({});
    start(async () => {
      const r = await lookupFlexAction(raw);
      setRes(r);
      setSel(r.ok && r.linked ? r.linked.driverId : "");
    });
  }, []);

  const link = () => {
    if (!res?.ok || !sel) return;
    start(async () => {
      const m = await linkFlexAction(res.flexDriverId, sel, res.shipmentId);
      setMsg(m);
      if (m.ok) setRes(await lookupFlexAction(res.shipmentId));
    });
  };

  return (
    <div className="space-y-4">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          search(q);
        }}
      >
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Número de envío de ML (p. ej. 46123456789) o código del pedido" inputMode="text" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        <button disabled={busy || !q.trim()} className="rounded-lg bg-brand px-4 text-sm font-medium text-white disabled:opacity-50">{busy ? "Buscando…" : "Buscar"}</button>
      </form>
      <button type="button" onClick={() => setShowScanner((v) => !v)} className="text-sm text-brand hover:underline">
        {showScanner ? "Ocultar escáner" : "…o escanear el QR del paquete"}
      </button>
      {showScanner && <Scanner onScan={search} busy={busy} />}

      {res && !res.ok && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {res.shipmentId && <p className="font-mono text-xs">Envío {res.shipmentId}</p>}
          <p className="font-medium">{res.error}</p>
          {res.detail && <p className="mt-1 break-all font-mono text-xs text-red-700/80">{res.detail}</p>}
          {res.shipmentId && (
            <button type="button" disabled={busy} onClick={() => start(async () => setDiag(await diagnoseFlexAction(res.shipmentId!)))} className="mt-2 text-xs text-red-800 underline">
              Diagnóstico (administradores)
            </button>
          )}
          {diag && <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded bg-white p-2 text-xs text-slate-700">{diag}</pre>}
        </div>
      )}

      {res?.ok && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm">
          <p className="font-mono text-xs text-slate-500">Envío {res.shipmentId} · consultado con la cuenta {res.via === "vendedor" ? "del vendedor" : "de la mensajería"}</p>
          <p className="mt-1 text-base">
            Driver Flex <span className="font-mono font-semibold">{res.flexDriverId}</span>
            {res.nickname && <span className="text-slate-500"> · {res.nickname}</span>}
          </p>
          {res.linked ? (
            <p className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-emerald-800">
              Ya está vinculado a <strong>{res.linked.name}</strong> <span className="font-mono text-xs">({res.linked.username})</span>. Puedes cambiarlo abajo.
            </p>
          ) : (
            <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-amber-800">Este driver Flex aún no está vinculado a ningún repartidor de Packatelas.</p>
          )}
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <label className="min-w-56 flex-1">
              <span className="text-xs text-slate-600">Repartidor de Packatelas</span>
              <select value={sel} onChange={(e) => setSel(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2">
                <option value="">— Elige al repartidor —</option>
                {drivers.map((d) => (
                  <option key={d.id} value={d.id}>{d.name} ({d.username})</option>
                ))}
              </select>
            </label>
            <button type="button" onClick={link} disabled={busy || !sel || (res.linked?.driverId === sel)} className="rounded-lg bg-brand px-4 py-2 font-medium text-white disabled:opacity-50">
              {res.linked ? "Actualizar vínculo" : "Vincular"}
            </button>
          </div>
          {msg.ok && <p className="mt-2 text-emerald-700">{msg.ok}</p>}
          {msg.error && <p className="mt-2 text-red-700">{msg.error}</p>}
        </div>
      )}
    </div>
  );
}
