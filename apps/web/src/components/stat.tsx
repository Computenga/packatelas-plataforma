export function Stat({ label, value, hint, tone = "brand" }: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: "brand" | "amber" | "green" | "red";
}) {
  const bar = { brand: "bg-brand", amber: "bg-accent", green: "bg-emerald-500", red: "bg-red-500" }[tone];
  return (
    <div className="relative min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white p-3 sm:p-4">
      <span className={`absolute inset-y-0 left-0 w-1 ${bar}`} />
      <p className="text-[11px] font-medium uppercase leading-tight tracking-wide text-slate-500 [hyphens:auto] [overflow-wrap:break-word] sm:text-xs">{label}</p>
      <p className="mt-1 text-xl font-bold tabular-nums sm:text-2xl">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

export const mxn = (n: number | string) =>
  new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(Number(n));
