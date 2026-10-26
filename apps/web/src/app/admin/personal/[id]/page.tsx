import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { employeeFile, prisma, quincenaOf, ymdMx } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import { ROLE_LABEL } from "@/lib/roles";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, Field, PageHeader, Select } from "@/components/ui";
import { EmployeeForm } from "../employee-form";
import { DocListAdmin } from "@/components/doc-list-admin";
import { DocUploader } from "@/components/doc-uploader";
import { linkUserAction, updateEmployee } from "../actions";

export const metadata: Metadata = { title: "Empleado" };
const today = () => ymdMx(new Date());

export default async function EmpleadoPage({ params }: PageProps<"/admin/personal/[id]">) {
  await requireUser(["ADMIN"]);
  const { id } = await params;
  const e = await prisma.employee.findUnique({ where: { id }, include: { user: { select: { id: true, username: true, role: true } } } });
  if (!e) notFound();
  const freeUsers = await prisma.user.findMany({
    where: { employee: null, role: { not: "CLIENTE" }, active: true },
    select: { id: true, username: true, name: true, role: true },
    orderBy: { name: "asc" },
  });
  const q = quincenaOf(today());
  const file = await employeeFile(prisma, e.id);
  const missingDocs = file.filter((r) => r.type.required && r.doc?.status !== "APROBADO").length;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        eyebrow={`Personal · #${e.employeeNo}`}
        title={e.name}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href={`/admin/personal/${e.id}/documentos`} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">Documentos RH</Link>
            <Link href={`/admin/checador/${e.id}?q=${q.key}`} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">Asistencia de la quincena</Link>
          </div>
        }
      >
        {e.status === "ACTIVO" ? <Badge tone="green">Activo</Badge> : <Badge>Baja</Badge>} · Flotilla U-{e.employeeNo}
      </PageHeader>
      <Card title="Datos"><EmployeeForm action={updateEmployee.bind(null, e.id)} e={e} submitLabel="Guardar" /></Card>
      <Card title={`Expediente${missingDocs ? ` · ${missingDocs} pendiente(s)` : " · completo"}`}>
        <DocListAdmin rows={file} />
        <details className="mt-3 border-t border-slate-100 pt-3">
          <summary className="cursor-pointer text-sm text-brand">Subir documento por el empleado</summary>
          <DocUploader endpoint="/api/docs/upload" extra={{ employeeId: e.id }} rows={file.map(({ type, doc }) => ({ key: type.key, name: type.name, description: null, required: type.required, status: doc?.status === "APROBADO" ? null : (doc?.status ?? null), comment: null }))} />
        </details>
      </Card>
      <Card title="Acceso a la plataforma">
        {e.user ? (
          <p className="mb-3 text-sm">Entra con el usuario <span className="font-mono">{e.user.username}</span> ({ROLE_LABEL[e.user.role]}). Ve su asistencia en su portal.</p>
        ) : (
          <p className="mb-3 text-sm text-slate-600">Sin acceso. Liga su usuario de repartidor o crea uno de empleado para que vea su asistencia.</p>
        )}
        <ActionForm action={linkUserAction.bind(null, e.id)} submitLabel={e.user ? "Cambiar" : "Dar acceso"}>
          <Select label="Usuario existente" name="userId" defaultValue="">
            <option value="">— Crear usuario de empleado nuevo —</option>
            {e.user && <option value="__none">Quitar acceso</option>}
            {freeUsers.map((u) => <option key={u.id} value={u.id}>{u.name} · {u.username} ({ROLE_LABEL[u.role]})</option>)}
          </Select>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Usuario nuevo" name="username" autoCapitalize="none" placeholder={`e${e.employeeNo}`} />
            <Field label="Contraseña" name="password" type="password" minLength={8} />
          </div>
        </ActionForm>
      </Card>
    </div>
  );
}
