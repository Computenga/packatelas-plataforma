/** Entregas por hora (una sola serie; el título la nombra). Horario extra 19–23 h sombreado. */
export function HourChart({ data }: { data: number[] }) {
  const max = Math.max(1, ...data);
  // Desde las 7 h, o antes si hubo entregas más temprano (no se esconde nada).
  const first = Math.min(7, Math.max(0, data.findIndex((n) => n > 0)));
  const hours = data.map((n, h) => ({ h, n })).slice(first, 24);
  return (
    <figure>
      <div className="relative flex h-44 items-end gap-[2px] border-b border-slate-300 pt-2" role="img" aria-label="Entregas por hora del día">
        {hours.map(({ h, n }) => (
          <div key={h} className={`group relative flex h-full flex-1 items-end ${h >= 19 && h < 23 ? "bg-amber-50" : h >= 23 ? "bg-red-50" : ""}`}>
            <div className="w-full rounded-t-[4px] bg-brand transition-opacity group-hover:opacity-80" style={{ height: `${(n / max) * 100}%`, minHeight: n ? 2 : 0 }} />
            <span className="pointer-events-none absolute -top-6 left-1/2 z-10 hidden -translate-x-1/2 whitespace-nowrap rounded bg-slate-900 px-2 py-0.5 text-[11px] text-white group-hover:block">
              {h}:00 · {n} entrega(s)
            </span>
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-[2px] text-[10px] text-slate-500">
        {hours.map(({ h }) => <span key={h} className="flex-1 text-center">{h % 2 === 1 ? h : ""}</span>)}
      </div>
      <figcaption className="mt-2 flex flex-wrap gap-4 text-xs text-slate-500">
        <span><span className="mr-1 inline-block h-3 w-3 rounded-sm border border-amber-200 bg-amber-50 align-middle" />Horario extra (19–23 h)</span>
        <span><span className="mr-1 inline-block h-3 w-3 rounded-sm border border-red-200 bg-red-50 align-middle" />23 h o después (no cuenta)</span>
      </figcaption>
      <table className="sr-only"><tbody>{data.map((n, h) => <tr key={h}><td>{h}:00</td><td>{n}</td></tr>)}</tbody></table>
    </figure>
  );
}
