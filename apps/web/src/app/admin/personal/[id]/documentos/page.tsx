import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma, ymdMx } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import { getEmpresa } from "@/lib/rh-empresa";
import { FRACCIONES } from "@/lib/rh-text";
import { Card, PageHeader } from "@/components/ui";
import { RhGenerator } from "./generator";
import { EmpresaForm } from "./empresa-form";

export const metadata: Metadata = { title: "Documentos RH" };

export default async function RhDocsPage({ params }: PageProps<"/admin/personal/[id]/documentos">) {
  await requireUser(["ADMIN"]);
  const { id } = await params;
  const e = await prisma.employee.findUnique({ where: { id } });
  if (!e) notFound();
  const [empresa, charges] = await Promise.all([
    getEmpresa(),
    prisma.employeeCharge.findMany({ where: { employeeId: id, payrollLine: null }, orderBy: { createdAt: "asc" } }),
  ]);
  const ymd = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");
  const isRepartidor = /repart/i.test(`${e.kind ?? ""} ${e.position ?? ""}`);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        eyebrow={`Personal · ${e.name}`}
        title="Documentos de RH"
        actions={<Link href={`/admin/personal/${e.id}`} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">← Volver al empleado</Link>}
      >
        Contrato, anexo, constancia, finiquito, renuncia, rescisión y confidencialidad con las plantillas de la empresa. Revisa cada documento antes de imprimir y firmar.
      </PageHeader>
      <RhGenerator
        employeeId={e.id}
        today={ymdMx(new Date())}
        fracciones={FRACCIONES}
        emp={{
          nombre: e.name, curp: e.curp ?? "", rfc: e.rfc ?? "", puesto: e.position ?? "", domicilio: e.address ?? "",
          ingreso: ymd(e.hireDate), baja: ymd(e.endDate), salario: Number(e.dailySalary ?? 0), esRepartidor: isRepartidor,
        }}
        deducciones={charges.map((c) => ({ concepto: c.description, importe: Number(c.amount) }))}
      />
      <Card title="Datos de la empresa (para contratos)">
        <EmpresaForm empresa={empresa} />
      </Card>
    </div>
  );
}
