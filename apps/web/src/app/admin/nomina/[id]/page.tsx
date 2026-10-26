import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import { ActionForm } from "@/components/action-form";
import { Card, Field, PageHeader, Select } from "@/components/ui";
import { PayrollReceiptView } from "@/components/payroll-receipt";
import { addLineAction, removeLineAction, statusAction } from "../actions";
import { RunButton } from "../buttons";

export const metadata: Metadata = { title: "Recibo de nómina" };

export default async function ReciboAdmin({ params }: PageProps<"/admin/nomina/[id]">) {
  await requireUser(["ADMIN"]);
  const { id } = await params;
  const r = await prisma.payrollReceipt.findUnique({ where: { id }, include: { lines: true, employee: { select: { employeeNo: true, name: true, rfc: true, curp: true, nss: true, position: true } } } });
  if (!r) notFound();
  const draft = r.status === "BORRADOR";
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader eyebrow="Nómina" title={`${r.employee.name} · ${r.quincena}`} actions={<Link href={`/admin/nomina?q=${r.quincena}`} className="text-sm text-brand">← Quincena</Link>}>
        {r.status === "BORRADOR" ? "Borrador: puedes agregar bonos o descuentos." : r.status === "APROBADO" ? "Aprobado: el empleado ya lo ve en su portal." : "Pagado."}{" "}
        <Link href={`/recibo/${r.id}`} target="_blank" className="text-brand">Ver para imprimir</Link>
      </PageHeader>
      <PayrollReceiptView r={r} onRemove={draft ? (lineId) => {
        const l = r.lines.find((x) => x.id === lineId);
        return l && (!l.auto || l.chargeId) ? <RunButton run={removeLineAction.bind(null, r.id, lineId)} label="Quitar" variant="danger" /> : null;
      } : undefined} />
      {draft && (
        <Card title="Agregar bono o descuento">
          <ActionForm action={addLineAction.bind(null, r.id)} submitLabel="Agregar" resetOnSuccess>
            <div className="grid gap-4 sm:grid-cols-[160px_1fr_140px]">
              <Select label="Tipo" name="kind" defaultValue="PERCEPCION">
                <option value="PERCEPCION">Percepción (+)</option>
                <option value="DEDUCCION">Deducción (−)</option>
              </Select>
              <Field label="Concepto" name="concept" required placeholder="Bono de productividad" />
              <Field label="Monto" name="amount" type="number" step="0.01" min="0.01" required />
            </div>
          </ActionForm>
        </Card>
      )}
      <Card title="Estado">
        <div className="flex flex-wrap items-end gap-4">
          {r.status === "BORRADOR" && <ActionForm action={statusAction.bind(null, r.id, "APROBADO")} submitLabel="Aprobar"><span /></ActionForm>}
          {r.status === "APROBADO" && (
            <>
              <ActionForm action={statusAction.bind(null, r.id, "PAGADO")} submitLabel="Marcar pagado">
                <Field label="Referencia de la transferencia" name="paymentRef" placeholder="Opcional" />
              </ActionForm>
              <ActionForm action={statusAction.bind(null, r.id, "BORRADOR")} submitLabel="Regresar a borrador"><span /></ActionForm>
            </>
          )}
          {r.status === "PAGADO" && <ActionForm action={statusAction.bind(null, r.id, "APROBADO")} submitLabel="Quitar marca de pagado"><span /></ActionForm>}
        </div>
      </Card>
    </div>
  );
}
