import Link from "next/link";
import { presets } from "@/lib/report-range";

/** Filtros del informe en un solo renglón: atajos y rango libre. */
export function RangeForm({ base, fromYmd, toYmd, extra }: { base: string; fromYmd: string; toYmd: string; extra?: Record<string, string> }) {
  const q = (from: string, to: string) => new URLSearchParams({ ...extra, from, to }).toString();
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      {presets().map((p) => {
        const on = p.from === fromYmd && p.to === toYmd;
        return (
          <Link key={p.label} href={`${base}?${q(p.from, p.to)}`} className={`rounded-lg border px-3 py-1.5 ${on ? "border-brand bg-brand/5 font-medium text-brand" : "border-slate-200 bg-white text-slate-700"}`}>
            {p.label}
          </Link>
        );
      })}
      <form className="flex items-center gap-1">
        {Object.entries(extra ?? {}).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        <input type="date" name="from" defaultValue={fromYmd} aria-label="Desde" className="rounded-lg border border-slate-300 px-2 py-1.5" />
        <span className="text-slate-400">a</span>
        <input type="date" name="to" defaultValue={toYmd} aria-label="Hasta" className="rounded-lg border border-slate-300 px-2 py-1.5" />
        <button className="rounded-lg bg-brand px-3 py-1.5 text-white">Ver</button>
      </form>
    </div>
  );
}
