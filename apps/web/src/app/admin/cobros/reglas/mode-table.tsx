"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Badge } from "@/components/ui";
import { setModeAction } from "./actions";

type Row = {
  id: string; name: string; publicId: string; mode: "PREPAID" | "WEEKLY_CREDIT"; vol: number;
  balance: string; owes: boolean; overdue: string | null; status: string; suggestion: "califica" | "debajo" | null;
};

export function ModeTable({ rows }: { rows: Row[] }) {
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [credit, toCredit, p1] = useActionState(setModeAction.bind(null, "WEEKLY_CREDIT"), {});
  const [prepaid, toPrepaid, p2] = useActionState(setModeAction.bind(null, "PREPAID"), {});
  const msg = credit.ok || credit.error ? credit : prepaid;
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const hidden = [...sel].map((id) => <input key={id} type="hidden" name="clientIds" value={id} />);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <form action={toCredit}>{hidden}<button disabled={!sel.size || p1} className="rounded-lg bg-brand px-3 py-1.5 font-medium text-white disabled:opacity-40">Pasar a crédito semanal ({sel.size})</button></form>
        <form action={toPrepaid}>{hidden}<button disabled={!sel.size || p2} className="rounded-lg border border-slate-300 px-3 py-1.5 disabled:opacity-40">Pasar a prepago</button></form>
        <button type="button" className="text-xs text-brand" onClick={() => setSel(new Set(rows.filter((r) => r.suggestion === "califica").map((r) => r.id)))}>Seleccionar los que califican</button>
        {msg.ok && <span role="status" className="text-emerald-700">{msg.ok}</span>}
        {msg.error && <span role="alert" className="text-red-600">{msg.error}</span>}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase text-slate-500">
            <tr><th className="w-6" /><th className="px-2 py-2">Cliente</th><th className="px-2 py-2 text-right">Envíos 7 d</th><th className="px-2 py-2">Forma de pago</th><th className="px-2 py-2 text-right">Saldo</th><th className="px-2 py-2">Recolección</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.id} className={sel.has(r.id) ? "bg-brand/5" : ""}>
                <td><input type="checkbox" aria-label={`Seleccionar ${r.name}`} checked={sel.has(r.id)} onChange={() => toggle(r.id)} className="accent-brand" /></td>
                <td className="px-2 py-1.5">
                  <Link href={`/admin/cobros/${r.id}`} className="text-brand hover:underline">{r.name}</Link>
                  <span className="ml-1 font-mono text-[11px] text-slate-400">{r.publicId}</span>
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums">{r.vol}</td>
                <td className="px-2 py-1.5">
                  {r.mode === "WEEKLY_CREDIT" ? "Crédito semanal" : "Prepago"}{" "}
                  {r.suggestion === "califica" && <Badge tone="blue">Califica</Badge>}
                  {r.suggestion === "debajo" && <Badge tone="amber">Debajo</Badge>}
                </td>
                <td className={`px-2 py-1.5 text-right tabular-nums ${r.owes ? "text-red-600" : ""}`}>
                  {r.balance}
                  {r.overdue && <span className="block text-[11px]">vencido {r.overdue}</span>}
                </td>
                <td className="px-2 py-1.5">
                  <Badge tone={r.status === "Bloqueada" ? "red" : r.status === "Exenta" ? "blue" : "green"}>{r.status}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
