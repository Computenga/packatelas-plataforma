import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { attendanceReport, prisma, shiftQuincena } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import { mxn } from "@/lib/format";
import { AttendanceDays } from "@/components/attendance-days";
import { PageHeader } from "@/components/ui";
import { Stat } from "@/components/stat";
import { readQuincena } from "@/lib/quincena";

export const metadata: Metadata = { title: "Asistencia" };

export default async function AsistenciaEmpleadoPage({ params, searchParams }: PageProps<"/admin/checador/[id]">) {
  await requireUser(["ADMIN"]);
  const { id } = await params;
  const q = readQuincena((await searchParams).q);
  if (!(await prisma.employee.findUnique({ where: { id }, select: { id: true } }))) notFound();
  const [r] = await attendanceReport(prisma, q.from, q.to, [id]);
  if (!r) notFound();
  const prev = shiftQuincena(q.key, -1), next = shiftQuincena(q.key, 1);
  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <PageHeader eyebrow={`Checador · #${r.employee.employeeNo}`} title={r.employee.name}>
        Entrada {r.employee.entryTime ?? "sin definir"} · <Link href={`/admin/personal/${id}`} className="text-brand hover:underline">Ficha</Link> · <Link href={`/admin/checador?q=${q.key}`} className="text-brand hover:underline">Todos</Link>
      </PageHeader>
      <div className="flex items-center gap-3 text-sm">
        <Link href={`/admin/checador/${id}?q=${prev.key}`} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5">←</Link>
        <span className="font-semibold">{q.label}</span>
        <Link href={`/admin/checador/${id}?q=${next.key}`} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5">→</Link>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Faltas" value={r.absences} tone="red" />
        <Stat label="Minutos tarde" value={r.lateMinutes} tone="amber" hint={`${r.lateDays} retardo(s)`} />
        <Stat label="Comida extra (min)" value={r.extraLunchMinutes} tone="amber" />
        <Stat label="Descuento estimado" value={r.discount == null ? "—" : mxn(r.discount)} hint={r.discount == null ? "Captura su salario diario" : undefined} />
      </div>
      <AttendanceDays days={r.days} showLunch={r.employee.punchesPerDay >= 4} />
    </div>
  );
}
