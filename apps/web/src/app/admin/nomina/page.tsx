import type { Metadata } from "next";
import Link from "next/link";
import { prisma, receiptTotals, shiftQuincena } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import { mxn } from "@/lib/format";
import { readQuincena } from "@/lib/quincena";
import { Badge, PageHeader, Table, Td } from "@/components/ui";
import { approveAllAction, generateAction } from "./actions";
import { RunButton } from "./buttons";

export const metadata: Metadata = { title: "Nómina" };
const STATUS = { BORRADOR: ["Borrador", "gray"], APROBADO: ["Aprobado", "blue"], PAGADO: ["Pagado", "green"] } as const;

/** Nómina quincenal [A25, A26]. */
export default async function NominaPage({ searchParams }: PageProps<"/admin/nomina">) {
  await requireUser(["ADMIN"]);
  const q = readQuincena((await searchParams).q);
  const receipts = await prisma.payrollReceipt.findMany({
    where: { quincena: q.key },
    include: { lines: true, employee: { select: { employeeNo: true, name: true, clabe: true } } },
    orderBy: { employee: { employeeNo: "asc" } },
  });
  const rows = receipts.map((r) => ({ r, t: receiptTotals(r.lines) }));
  const total = rows.reduce((a, x) => a + Number(x.t.net), 0);
  const drafts = receipts.filter((r) => r.status === "BORRADOR").length;
  const nav = (d: number) => `?q=${shiftQuincena(q.key, d)}`;
  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHeader eyebrow="Interno" title="Nómina" actions={<Link href={`/admin/nomina/exportar?q=${q.key}`} prefetch={false} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">Exportar CSV para transferencias</Link>}>
        Sueldo de 15 días menos faltas y retardos del checador y adeudos (taller, etc.). Recibo virtual: no sustituye al CFDI timbrado.
      </PageHeader>
      <div className="flex flex-wrap items-center gap-3">
        <Link href={nav(-1)} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm">←</Link>
        <span className="font-medium">{q.label}</span>
        <Link href={nav(1)} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm">→</Link>
        <RunButton run={generateAction.bind(null, q.key)} label={receipts.length ? "Recalcular borradores" : "Generar recibos"} />
        {drafts > 0 && <RunButton run={approveAllAction.bind(null, q.key)} label={`Aprobar ${drafts} borrador(es)`} variant="secondary" confirm="¿Aprobar todos? El empleado los verá en su portal." />}
      </div>
      <Table head={["No.", "Empleado", "Percepciones", "Deducciones", "Neto", "CLABE", "Estado"]} empty={rows.length ? undefined : "Aún no hay recibos de esta quincena. Da “Generar recibos” (solo empleados activos con salario diario)."}>
        {rows.map(({ r, t }) => (
          <tr key={r.id} className="hover:bg-slate-50">
            <Td className="font-mono text-xs">{r.employee.employeeNo}</Td>
            <Td><Link href={`/admin/nomina/${r.id}`} className="font-medium text-brand hover:underline">{r.employee.name}</Link></Td>
            <Td>{mxn(t.perceptions)}</Td>
            <Td className="text-red-700">{Number(t.deductions) ? `−${mxn(t.deductions)}` : "—"}</Td>
            <Td className={`font-semibold ${t.net.lt(0) ? "text-red-700" : ""}`}>{mxn(t.net)}</Td>
            <Td className="font-mono text-xs">{r.employee.clabe ?? <span className="text-amber-700">Sin CLABE</span>}</Td>
            <Td><Badge tone={STATUS[r.status][1]}>{STATUS[r.status][0]}</Badge></Td>
          </tr>
        ))}
      </Table>
      {rows.length > 0 && <p className="text-right text-sm">Total neto: <strong>{mxn(total)}</strong></p>}
    </div>
  );
}
