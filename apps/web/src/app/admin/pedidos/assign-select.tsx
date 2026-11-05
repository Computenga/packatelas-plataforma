"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { assignAction } from "../despacho/actions";

/** Asignar o cambiar de repartidor sin abrir el pedido (como el panel de 99minutos). */
export function AssignSelect({ orderId, current, drivers }: { orderId: string; current: string | null; drivers: { id: string; name: string; onDuty: boolean }[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string>();
  return (
    <span className="inline-flex items-center gap-2">
      <select
        defaultValue={current ?? ""}
        disabled={pending}
        aria-label="Repartidor"
        onChange={(e) => {
          const id = e.target.value;
          if (!id) return;
          start(async () => {
            const r = await assignAction([orderId], id);
            setMsg(r.error ?? "✓");
            router.refresh();
          });
        }}
        className={`max-w-48 rounded-md border-[1.5px] px-2 py-1 text-[13px] font-semibold ${current ? "border-slate-200 bg-white" : "border-accent bg-amber-50"}`}
      >
        <option value="" disabled>Asignar…</option>
        {drivers.map((d) => (
          <option key={d.id} value={d.id}>{d.name}{d.onDuty ? "" : " (fuera de turno)"}</option>
        ))}
      </select>
      {msg && <span className={`text-xs ${msg === "✓" ? "text-emerald-700" : "text-red-600"}`}>{msg}</span>}
    </span>
  );
}
