"use client";

import { useActionState, useState } from "react";
import { FormMessage } from "@/components/ui";
import type { ActionState } from "@/components/action-form";
import { payWithCardAction } from "./mp-actions";

const money = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" });

/** Abono con tarjeta por Mercado Pago: el cliente ve la comisión y el total antes de pagar. */
export function PayCard({ suggested, min, feeMode, feeValue }: { suggested: number; min: number; feeMode: "fijo" | "porcentaje"; feeValue: number }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(payWithCardAction, {});
  const [amount, setAmount] = useState(suggested >= min ? suggested.toFixed(2) : String(min));
  const n = Number(amount) || 0;
  const fee = Math.round((feeMode === "fijo" ? feeValue : (n * feeValue) / 100) * 100) / 100;
  return (
    <form action={action} className="space-y-3">
      <label className="block text-sm">
        <span className="text-slate-700">Monto a abonar</span>
        <input name="amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
      </label>
      {n > 0 && (
        <p className="text-sm text-slate-600">
          {fee > 0 ? <>Comisión por pago con tarjeta: {money.format(fee)} · </> : null}
          Total a pagar: <strong>{money.format(n + fee)}</strong>
          <br />
          <span className="text-xs">A tu saldo se abonan {money.format(n)}. Mínimo {money.format(min)}.</span>
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
