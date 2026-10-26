"use client";

import Link from "next/link";
import { useCallback, useState, useTransition } from "react";
import type { ScanOutcome } from "@packatelas/db";
import { Scanner } from "@/components/scanner";
import { linkAndScanAction, scanAction } from "./actions";

type Row = { id: number; at: Date; raw: string; result: ScanOutcome };

function feedback(ok: boolean) {
  try {
    navigator.vibrate?.(ok ? 60 : [80, 60, 80]);
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    osc.frequency.value = ok ? 880 : 220;
    osc.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + (ok ? 0.08 : 0.25));
  } catch {
    // sin audio/vibración disponible
  }
}

const tone: Record<ScanOutcome["status"], string> = {
  created: "border-emerald-200 bg-emerald-50",
  existing: "border-blue-200 bg-blue-50",
  unknown_account: "border-amber-200 bg-amber-50",
  invalid: "border-red-200 bg-red-50",
};

export function ScanStation({ branches = [], clients = [] }: { branches?: { id: string; label: string }[]; /** solo administradores pueden ligar cuentas */ clients?: { publicId: string; name: string }[] }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [branchHint, setBranchHint] = useState("");
  const [pending, startTransition] = useTransition();
  const created = rows.filter((r) => r.result.status === "created").length;

  const onScan = useCallback((raw: string) => {
    startTransition(async () => {
      let result: ScanOutcome;
      try {
        result = await scanAction(raw, branchHint || undefined);
      } catch {
        result = { status: "invalid", message: "Sin conexión con el servidor; vuelve a escanear" };
      }
      feedback(result.status === "created" || result.status === "existing");
      setRows((prev) => [{ id: Date.now(), at: new Date(), raw, result }, ...prev].slice(0, 200));
    });
  }, [branchHint]);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,420px)_1fr]">
      <div>
        {branches.length > 0 && (
          <label className="mb-3 block text-sm">
            <span className="font-medium text-slate-700">Recibiendo de</span>
            <select value={branchHint} onChange={(e) => setBranchHint(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2">
              <option value="">Sucursal predeterminada de cada cuenta</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
            </select>
            <span className="mt-1 block text-xs text-slate-500">Solo aplica a cuentas de MercadoLibre que llegan a varias sucursales.</span>
          </label>
        )}
        <Scanner onScan={onScan} busy={pending} />
        <p className="mt-3 text-sm text-slate-600">
          Esta sesión: <strong>{created}</strong> nuevo(s) · {rows.length} lectura(s)
        </p>
      </div>

      <ul className="space-y-2">
        {rows.length === 0 && <li className="text-sm text-slate-500">Las lecturas aparecerán aquí.</li>}
        {rows.map((r) => (
          <li key={r.id} className={`rounded-lg border px-4 py-3 text-sm ${tone[r.result.status]}`}>
            <ResultLine result={r.result} />
            {r.result.status === "unknown_account" && r.result.senderId && clients.length > 0 && (
              <LinkAccount raw={r.raw} senderId={r.result.senderId} clients={clients}
                onDone={(result) => setRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, result } : x)))} />
            )}
            <p className="mt-0.5 text-xs text-slate-500">{r.at.toLocaleTimeString("es-MX")}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ResultLine({ result }: { result: ScanOutcome }) {
  switch (result.status) {
    case "created":
      return (
        <p>
          <strong>Nuevo:</strong>{" "}
          <Link href={`/admin/pedidos/${result.orderId}`} className="font-mono underline">
            {result.code}
          </Link>{" "}
          · {result.clientName} {result.charged ? "· cargo registrado" : "· sin cobro"}
        </p>
      );
    case "existing":
      return (
        <p>
          <strong>Ya registrado:</strong>{" "}
          <Link href={`/admin/pedidos/${result.orderId}`} className="font-mono underline">
            {result.code}
          </Link>{" "}
          · {result.clientName}
        </p>
      );
    case "unknown_account":
      return (
        <p>
          <strong>Cuenta sin ligar:</strong> envío <span className="font-mono">{result.shipmentId}</span>. {result.message}.
        </p>
      );
    case "invalid":
      return (
        <p>
          <strong>No válido:</strong> {result.message}
        </p>
      );
  }
}

function LinkAccount({ raw, senderId, clients, onDone }: { raw: string; senderId: string; clients: { publicId: string; name: string }[]; onDone: (r: ScanOutcome) => void }) {
  const [publicId, setPublicId] = useState("");
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <select value={publicId} onChange={(e) => setPublicId(e.target.value)} aria-label="Cliente de esta cuenta" className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-sm">
        <option value="">¿De qué cliente es la cuenta {senderId}?</option>
        {clients.map((c) => <option key={c.publicId} value={c.publicId}>{c.publicId} · {c.name}</option>)}
      </select>
      <button type="button" disabled={!publicId || pending} className="rounded-md bg-brand px-3 py-1 text-sm font-medium text-white disabled:opacity-50"
        onClick={() => start(async () => {
          const r = await linkAndScanAction(raw, senderId, publicId);
          if (r.status === "error") setError(r.message);
          else { feedback(r.status === "created" || r.status === "existing"); onDone(r); }
        })}>
        {pending ? "Ligando…" : "Ligar y registrar"}
      </button>
      {error && <p role="alert" className="w-full text-xs text-red-700">{error}</p>}
    </div>
  );
}
