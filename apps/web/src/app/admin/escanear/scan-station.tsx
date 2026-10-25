"use client";

import Link from "next/link";
import { useCallback, useState, useTransition } from "react";
import type { ScanOutcome } from "@packatelas/db";
import { Scanner } from "@/components/scanner";
import { scanAction } from "./actions";

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

export function ScanStation() {
  const [rows, setRows] = useState<Row[]>([]);
  const [pending, startTransition] = useTransition();
  const created = rows.filter((r) => r.result.status === "created").length;

  const onScan = useCallback((raw: string) => {
    startTransition(async () => {
      let result: ScanOutcome;
      try {
        result = await scanAction(raw);
      } catch {
        result = { status: "invalid", message: "Sin conexión con el servidor; vuelve a escanear" };
      }
      feedback(result.status === "created" || result.status === "existing");
      setRows((prev) => [{ id: Date.now(), at: new Date(), raw, result }, ...prev].slice(0, 200));
    });
  }, []);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,420px)_1fr]">
      <div>
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
