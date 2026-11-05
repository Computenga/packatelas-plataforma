export function Stat({ label, value, hint, tone = "brand" }: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: "brand" | "amber" | "green" | "red";
}) {
  const bar = { brand: "border-brand", amber: "border-accent", green: "border-emerald-600", red: "border-red-600" }[tone];
  const num = tone === "red" && value !== 0 && value !== "0" ? "text-red-600" : "";
  // Cifra grande arriba, etiqueta abajo; el color va en la línea inferior.
  return (
    <div className={`min-w-0 rounded-xl border-b-4 bg-white p-3 sm:p-4 ${bar}`}>
      <p className={`font-display text-3xl leading-none font-black tabular-nums sm:text-4xl ${num}`}>{value}</p>
      <p className="mt-1 text-sm leading-tight font-semibold text-slate-600 [hyphens:auto] [overflow-wrap:break-word]">{label}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

export const mxn = (n: number | string) =>
  new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(Number(n));
