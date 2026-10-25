export function Stat({ label, value, hint, tone = "brand" }: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: "brand" | "amber" | "green" | "red";
}) {
  const bar = { brand: "bg-brand", amber: "bg-accent", green: "bg-emerald-500", red: "bg-red-500" }[tone];
  return (
    <div className="relative overflow-hidden rounded-xl border border-slate-200 bg-white p-4">
      <span className={`absolute inset-y-0 left-0 w-1 ${bar}`} />
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

export const mxn = (n: number | string) =>
  new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(Number(n));
