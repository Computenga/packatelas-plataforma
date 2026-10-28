"use client";

import { useActionState, useState } from "react";
import { FormMessage } from "@/components/ui";
import type { ActionState } from "@/components/action-form";
import { payWithCardAction } from "./mp-actions";

const money = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" });

type Tier = { upTo: number | null; percent: number; fixed: number };
const r2 = (n: number) => Math.round(n * 100) / 100;
const feeFor = (tiers: Tier[], paid: number) => {
  const t = tiers.find((x) => x.upTo == null || paid <= x.upTo) ?? tiers[tiers.length - 1];
  return t ? Math.min(r2((paid * t.percent) / 100 + t.fixed), paid) : 0;
};
/** Menor pago que, ya descontada la comisión, cubre `target`. */
function grossUp(tiers: Tier[], target: number) {
  let best = Infinity;
  let lower = 0;
  for (const t of tiers) {
    const p = Math.ceil(((target + t.fixed) / (1 - t.percent / 100)) * 100) / 100;
    const inTier = p > lower && (t.upTo == null || p <= t.upTo);
    if (inTier) best = Math.min(best, p);
    else if (p <= lower && lower > 0) best = Math.min(best, r2(lower + 0.01)); // el inicio del tramo ya alcanza
    if (t.upTo != null) lower = t.upTo;
  }
  return Number.isFinite(best) ? best : target;
}

/** Pago con tarjeta por Mercado Pago: el cliente ve la comisión y lo que se abona a su saldo antes de pagar. */
export function PayCard({ balance, min, tiers }: { balance: number; min: number; tiers: Tier[] }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(payWithCardAction, {});
  const suggested = balance > 0 ? Math.max(grossUp(tiers, balance), min) : min;
  const [amount, setAmount] = useState(suggested.toFixed(2));
  const n = r2(Number(amount) || 0);
  const fee = feeFor(tiers, n);
  return (
    <form action={action} className="space-y-3">
      <label className="block text-sm">
        <span className="text-slate-700">Monto a pagar con tarjeta</span>
        <input name="amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
      </label>
      {n > 0 && (
        <p className="text-sm text-slate-600">
          {fee > 0 ? <>Comisión por pago con tarjeta: −{money.format(fee)} · </> : <>Sin comisión · </>}
          Se abona a tu saldo: <strong>{money.format(r2(n - fee))}</strong>
          <br />
          <span className="text-xs">
            Pago mínimo {money.format(min)}.{balance > 0 && <> Para cubrir tu saldo de {money.format(balance)} paga {money.format(grossUp(tiers, balance))}.</>}
          </span>
          <br />
          <span className="text-xs">Comisión (se descuenta del pago): {tiers.map((t, i) => {
            const f = [t.percent ? `${t.percent}%` : "", t.fixed ? money.format(t.fixed) : ""].filter(Boolean).join(" y luego ") || "sin comisión";
            const prev = i > 0 ? tiers[i - 1].upTo : null;
            const edge = (v: number) => (Math.round(v * 100) % 100 === 99 ? `menos de ${money.format(Math.ceil(v))}` : `hasta ${money.format(v)}`);
            return `${t.upTo == null ? (prev != null ? `más de ${money.format(prev)}` : "todos") : edge(t.upTo)}: ${f}`;
          }).join(" · ")}.</span>
        </p>
      )}
      <FormMessage state={state} />
      <button type="submit" disabled={pending || n < min || n - fee <= 0} className="inline-flex items-center rounded-lg bg-[#009ee3] px-4 py-2 text-sm font-medium text-white hover:bg-[#0089c7] disabled:opacity-50">
        {pending ? "Abriendo Mercado Pago…" : "Pagar con tarjeta"}
      </button>
      <p className="text-xs text-slate-500">Se abre Mercado Pago para pagar con tarjeta de crédito o débito. El abono se refleja aquí en cuanto se aprueba.</p>
    </form>
  );
}
