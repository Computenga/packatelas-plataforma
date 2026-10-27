"use client";

import { useActionState, useState } from "react";
import { FormMessage } from "@/components/ui";
import type { ActionState } from "@/components/action-form";
import { payWithCardAction } from "./mp-actions";

const money = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" });

/** Abono con tarjeta por Mercado Pago: el cliente ve la comisión y el total antes de pagar. */
type Tier = { upTo: number | null; percent: number; fixed: number };
const feeFor = (tiers: Tier[], amount: number) => {
  const t = tiers.find((x) => x.upTo == null || amount <= x.upTo) ?? tiers[tiers.length - 1];
  return t ? Math.round(((amount * t.percent) / 100 + t.fixed) * 100) / 100 : 0;
};

export function PayCard({ suggested, min, tiers }: { suggested: number; min: number; tiers: Tier[] }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(payWithCardAction, {});
  const [amount, setAmount] = useState(suggested >= min ? suggested.toFixed(2) : String(min));
  const n = Number(amount) || 0;
  const fee = feeFor(tiers, Math.round(n * 100) / 100);
  return (
    <form action={action} className="space-y-3">
      <label className="block text-sm">
        <span className="text-slate-700">Monto a abonar</span>
        <input name="amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
      </label>
      {n > 0 && (
        <p className="text-sm text-slate-600">
          {fee > 0 ? <>Comisión por pago con tarjeta: {money.format(fee)} · </> : <>Sin comisión · </>}
          Total a pagar: <strong>{money.format(n + fee)}</strong>
          <br />
          <span className="text-xs">A tu saldo se abonan {money.format(n)}. Mínimo {money.format(min)}.</span>
          <br />
          <span className="text-xs">Comisión: {tiers.map((t, i) => {
            const f = [t.percent ? `${t.percent}%` : "", t.fixed ? money.format(t.fixed) : ""].filter(Boolean).join(" + ") || "sin comisión";
            const prev = i > 0 ? tiers[i - 1].upTo : null;
            const edge = (v: number) => (Math.round(v * 100) % 100 === 99 ? `menos de ${money.format(Math.ceil(v))}` : `hasta ${money.format(v)}`);
            return `${t.upTo == null ? (prev != null ? `más de ${money.format(prev)}` : "todos") : edge(t.upTo)}: ${f}`;
          }).join(" · ")}.</span>
        </p>
      )}
      <FormMessage state={state} />
      <button type="submit" disabled={pending || n < min} className="inline-flex items-center rounded-lg bg-[#009ee3] px-4 py-2 text-sm font-medium text-white hover:bg-[#0089c7] disabled:opacity-50">
        {pending ? "Abriendo Mercado Pago…" : "Pagar con tarjeta"}
      </button>
      <p className="text-xs text-slate-500">Se abre Mercado Pago para pagar con tarjeta de crédito o débito. El abono se refleja aquí en cuanto se aprueba.</p>
    </form>
  );
}
