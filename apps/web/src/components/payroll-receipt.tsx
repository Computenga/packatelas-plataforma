import { receiptTotals, type Prisma } from "@packatelas/db";
import { mxn } from "@/lib/format";

type Receipt = Prisma.PayrollReceiptGetPayload<{ include: { lines: true; employee: { select: { employeeNo: true; name: true; rfc: true; curp: true; nss: true; position: true } } } }>;
const fmt = (d: Date) => d.toLocaleDateString("es-MX", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" });

/** Recibo virtual de nómina (pantalla e impresión). */
export function PayrollReceiptView({ r, onRemove }: { r: Receipt; onRemove?: (lineId: string) => React.ReactNode }) {
  const t = receiptTotals(r.lines);
  const lines = [...r.lines].sort((a, b) => a.order - b.order);
  const block = (kind: "PERCEPCION" | "DEDUCCION", title: string) => (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</p>
      <ul className="divide-y divide-slate-100 text-sm">
        {lines.filter((l) => l.kind === kind).map((l) => (
          <li key={l.id} className="flex items-center justify-between gap-3 py-1.5">
            <span>{l.concept}</span>
            <span className="flex items-center gap-2 tabular-nums">{kind === "DEDUCCION" ? "−" : ""}{mxn(l.amount)}{onRemove?.(l.id)}</span>
          </li>
        ))}
        {!lines.some((l) => l.kind === kind) && <li className="py-1.5 text-slate-400">—</li>}
      </ul>
    </div>
  );
  return (
    <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 print:border-0 print:p-0">
      <div className="flex flex-wrap justify-between gap-2 border-b border-slate-100 pb-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">Recibo de nómina · Comercializadora Computenga</p>
          <p className="text-lg font-bold">{r.employee.name}</p>
          <p className="text-xs text-slate-500">No. {r.employee.employeeNo}{r.employee.position ? ` · ${r.employee.position}` : ""}{r.employee.rfc ? ` · RFC ${r.employee.rfc}` : ""}{r.employee.nss ? ` · NSS ${r.employee.nss}` : ""}</p>
        </div>
        <div className="text-right text-sm">
          <p>Periodo: {fmt(r.periodFrom)} – {fmt(r.periodTo)}</p>
          <p className="text-xs text-slate-500">Salario diario {mxn(r.dailySalary)}</p>
          {r.paidAt && <p className="text-xs text-emerald-700">Pagado el {r.paidAt.toLocaleDateString("es-MX", { timeZone: "America/Mexico_City" })}{r.paymentRef ? ` · ref. ${r.paymentRef}` : ""}</p>}
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {block("PERCEPCION", "Percepciones")}
        {block("DEDUCCION", "Deducciones")}
      </div>
      <div className="flex justify-between border-t border-slate-200 pt-3 text-base font-bold">
        <span>Neto a pagar</span><span className="tabular-nums">{mxn(t.net)}</span>
      </div>
      <p className="text-[11px] text-slate-400">Recibo informativo. No sustituye al CFDI de nómina timbrado.</p>
    </div>
  );
}
