import Link from "next/link";
import { prisma, receiptTotals } from "@packatelas/db";
import { mxn } from "@/lib/format";

/** Recibos de nómina del empleado (aprobados y pagados) [A25]. */
export async function MyPayroll({ userId }: { userId: string }) {
  const emp = await prisma.employee.findUnique({ where: { userId }, select: { id: true } });
  if (!emp) return null;
  const receipts = await prisma.payrollReceipt.findMany({ where: { employeeId: emp.id, status: { not: "BORRADOR" } }, include: { lines: true }, orderBy: { periodFrom: "desc" }, take: 12 });
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4">
      <h2 className="font-semibold">Mis recibos de nómina</h2>
      {receipts.length === 0 ? <p className="mt-1 text-sm text-slate-500">Aún no hay recibos.</p> : (
        <ul className="mt-2 divide-y divide-slate-100 text-sm">
          {receipts.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-2 py-2">
              <Link href={`/recibo/${r.id}`} className="text-brand">Quincena {r.quincena}</Link>
              <span className="tabular-nums font-medium">{mxn(receiptTotals(r.lines).net)}</span>
              <span className={`text-xs ${r.status === "PAGADO" ? "text-emerald-700" : "text-blue-700"}`}>{r.status === "PAGADO" ? "Pagado" : "Por pagar"}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
