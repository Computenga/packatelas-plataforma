"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState, useTransition } from "react";
import type { ReturnOutcome } from "@packatelas/db";
import { Scanner } from "@/components/scanner";
import { returnScanAction } from "./actions";

type Mode = "receive" | "deliver";
type Line = { id: number; mode: Mode; r: ReturnOutcome };

export function ReturnStation() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("receive");
  const [lines, setLines] = useState<Line[]>([]);
  const [pending, start] = useTransition();

  const onScan = useCallback(
    (raw: string) =>
      start(async () => {
        let r: ReturnOutcome;
        try {
          r = await returnScanAction(mode, raw);
        } catch {
          r = { status: "error", message: "Sin conexión; vuelve a escanear" };
        }
        navigator.vibrate?.(r.status === "error" ? [80, 60, 80] : 60);
        setLines((p) => [{ id: Date.now(), mode, r }, ...p].slice(0, 100));
        router.refresh();
      }),
    [mode, router],
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,420px)_1fr]">
      <div>
        <div className="mb-3 grid grid-cols-2 gap-2">
          {(
            [
              ["receive", "1 · Recibir en Packatelas"],
              ["deliver", "2 · Devolver al vendedor"],
            ] as const
          ).map(([m, label]) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`rounded-lg px-3 py-2.5 text-sm font-medium ${mode === m ? "bg-brand text-white" : "border border-slate-300 bg-white text-slate-700"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <Scanner onScan={onScan} busy={pending} />
      </div>
      <ul className="space-y-2">
        {lines.length === 0 && <li className="text-sm text-slate-500">Las lecturas aparecerán aquí.</li>}
        {lines.map(({ id, mode: m, r }) => (
          <li
            key={id}
            className={`rounded-lg border px-4 py-3 text-sm ${r.status === "ok" ? "border-emerald-200 bg-emerald-50" : r.status === "already" ? "border-blue-200 bg-blue-50" : "border-red-200 bg-red-50"}`}
          >
            {r.status === "error" ? (
              r.message
            ) : (
              <>
                <span className="font-mono">{r.code}</span> · {r.clientName} ·{" "}
                {r.status === "already" ? "ya estaba registrado" : m === "receive" ? "recibido en almacén" : "devuelto al vendedor"}
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
