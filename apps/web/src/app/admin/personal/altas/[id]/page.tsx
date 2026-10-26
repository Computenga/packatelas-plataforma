import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { docTypesFor, HIRE_ROLES, latestByType, missingForSubmit, prisma } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import { DocListAdmin } from "@/components/doc-list-admin";
import { Badge, Card, PageHeader } from "@/components/ui";
import { Decide } from "./decide";

export const metadata: Metadata = { title: "Solicitud de alta" };
const LABELS: [string, string][] = [
  ["phone", "Celular"], ["email", "Correo"], ["curp", "CURP"], ["rfc", "RFC"], ["nss", "NSS"], ["address", "Domicilio"],
  ["clabe", "CLABE"], ["bank", "Banco"], ["emergencyName", "Emergencia"], ["emergencyPhone", "Tel. emergencia"], ["emergencyRelation", "Parentesco"],
];

export default async function AltaDetalle({ params }: PageProps<"/admin/personal/altas/[id]">) {
  await requireUser(["ADMIN"]);
  const { id } = await params;
  const a = await prisma.hireApplication.findUnique({ where: { id }, include: { documents: true } });
  if (!a) notFound();
  const [types, missing, last] = await Promise.all([
    docTypesFor(prisma, a.role), missingForSubmit(prisma, a.id), prisma.employee.aggregate({ _max: { employeeNo: true } }),
  ]);
  const latest = latestByType(a.documents);
  const open = a.status === "ENVIADA" || a.status === "EN_PROCESO";
  const allApproved = types.filter((t) => t.required).every((t) => latest.get(t.key)?.status === "APROBADO")
    && [...latest.values()].every((d) => d.status === "APROBADO");
  const rec = a as unknown as Record<string, string | null>;

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <PageHeader eyebrow="Personal · Altas" actions={<Link href="/admin/personal/altas" className="text-sm text-brand">← Todas las altas</Link>} title={a.name ?? "Sin nombre aún"}>
        {HIRE_ROLES[a.role] ?? a.role} · {a.status === "ENVIADA" ? <Badge tone="blue">Por revisar</Badge> : a.status === "EN_PROCESO" ? <Badge>Llenando</Badge> : a.status === "APROBADA" ? <Badge tone="green">Aprobada</Badge> : <Badge tone="red">Rechazada</Badge>}
        {a.employeeId && <> · <Link href={`/admin/personal/${a.employeeId}`} className="text-brand">Ver empleado</Link></>}
      </PageHeader>
      <Card title="Datos">
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          {LABELS.map(([k, l]) => <div key={k} className="flex gap-2"><dt className="w-32 shrink-0 text-slate-500">{l}</dt><dd className="break-all">{rec[k] || "—"}</dd></div>)}
        </dl>
      </Card>
      <Card title="Documentos">
        <DocListAdmin reviewable={open} rows={types.map((t) => ({ type: t, doc: latest.get(t.key) ?? null }))} />
      </Card>
      {open && (
        <Card title="Decisión">
          {a.status === "EN_PROCESO" && missing.length > 0 && <p className="mb-3 text-sm text-amber-700">Aún no la envía. Le falta: {missing.join(", ")}.</p>}
          {!allApproved && <p className="mb-3 text-sm text-slate-600">Para aprobar, todos los documentos deben estar aprobados.</p>}
          <Decide appId={a.id} nextNo={(last._max.employeeNo ?? 0) + 1} />
        </Card>
      )}
      {a.notes && <p className="text-sm text-slate-600">Nota: {a.notes}</p>}
    </div>
  );
}
