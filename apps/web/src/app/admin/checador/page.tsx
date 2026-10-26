import type { Metadata } from "next";
import Link from "next/link";
import { attendanceReport, prisma, shiftQuincena, ymdMx } from "@packatelas/db";
import { readQuincena } from "@/lib/quincena";
import { requireUser } from "@/lib/auth";
import { mxn } from "@/lib/format";
import { ActionForm } from "@/components/action-form";
import { ButtonLink, Card, PageHeader, Table, Td } from "@/components/ui";
import { AdmsCard } from "./adms-card";
import { Stat } from "@/components/stat";
import { justifyAction, removeJustification } from "./actions";

export const metadata: Metadata = { title: "Checador" };
const today = () => ymdMx(new Date());

/** Asistencia por quincena [A23]: retardos, faltas, comida extra y descuento estimado. */
export default async function ChecadorPage({ searchParams }: PageProps<"/admin/checador">) {
  await requireUser(["ADMIN"]);
  const q = readQuincena((await searchParams).q);
  const prev = shiftQuincena(q.key, -1), next = shiftQuincena(q.key, 1);
  const [rows, justs, employees, lastPunch] = await Promise.all([
    attendanceReport(prisma, q.from, q.to),
    prisma.justification.findMany({
      where: { date: { gte: new Date(`${q.from}T00:00:00Z`), lte: new Date(`${q.to}T00:00:00Z`) } },
      include: { employee: { select: { name: true } } }, orderBy: { date: "asc" },
    }),
    prisma.employee.findMany({ where: { status: "ACTIVO" }, select: { id: true, name: true, employeeNo: true }, orderBy: { name: "asc" } }),
    prisma.punch.findFirst({ orderBy: { at: "desc" }, select: { at: true } }),
  ]);
  const totals = rows.reduce((a, r) => ({ late: a.late + r.lateMinutes, abs: a.abs + r.absences, extra: a.extra + r.extraLunchMinutes, disc: a.disc + (r.discount ?? 0) }), { late: 0, abs: 0, extra: 0, disc: 0 });

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <PageHeader
        eyebrow="Interno"
        title="Checador"
        actions={<><ButtonLink href="/admin/personal/importar" variant="secondary">Importar checadas</ButtonLink><ButtonLink href={`/admin/checador/exportar?q=${q.key}`} variant="secondary" prefetch={false}>Exportar CSV</ButtonLink></>}
      >
        Tolerancia 0 min · falta = 1 día (8 h) · quincenas 1–15 y 16–fin de mes.{" "}
        {lastPunch ? `Última checada importada: ${new Intl.DateTimeFormat("es-MX", { timeZone: "America/Mexico_City", dateStyle: "medium", timeStyle: "short" }).format(lastPunch.at)}.` : "Aún no hay checadas importadas."}
      </PageHeader>

      <div className="flex items-center gap-3 text-sm">
        <Link href={`/admin/checador?q=${prev.key}`} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5">← {prev.label.split(" (")[0]}</Link>
        <span className="font-semibold">{q.label}</span>
        <Link href={`/admin/checador?q=${next.key}`} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5">{next.label.split(" (")[0]} →</Link>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Faltas" value={totals.abs} tone="red" />
        <Stat label="Minutos de retardo" value={totals.late} tone="amber" hint={`${(totals.late / 60).toFixed(1)} h`} />
        <Stat label="Comida de más (min)" value={totals.extra} tone="amber" />
        <Stat label="Descuento estimado" value={mxn(totals.disc)} hint="Con salario diario capturado" />
      </div>

      <Table head={["No.", "Empleado", "Días laborales", "Asistió", "Faltas", "Justificadas", "Retardos", "Min. tarde", "Comida extra", "Descuento"]} empty={rows.length ? undefined : "Sin empleados activos"}>
        {rows.map((r) => (
          <tr key={r.employee.id} className="hover:bg-slate-50">
            <Td className="font-mono text-xs">{r.employee.employeeNo}</Td>
            <Td><Link href={`/admin/checador/${r.employee.id}?q=${q.key}`} className="font-medium text-brand hover:underline">{r.employee.name}</Link>{!r.employee.entryTime && <span className="ml-1 text-xs text-amber-700">sin hora de entrada</span>}</Td>
            <Td className="text-right tabular-nums">{r.workdays}</Td>
            <Td className="text-right tabular-nums">{r.worked}</Td>
            <Td className={`text-right tabular-nums ${r.absences ? "font-semibold text-red-600" : ""}`}>{r.absences}</Td>
            <Td className="text-right tabular-nums">{r.justified}</Td>
            <Td className="text-right tabular-nums">{r.lateDays}</Td>
            <Td className={`text-right tabular-nums ${r.lateMinutes ? "text-amber-700" : ""}`}>{r.lateMinutes}</Td>
            <Td className="text-right tabular-nums">{r.extraLunchMinutes}</Td>
            <Td className="text-right tabular-nums">{r.discount == null ? "—" : mxn(r.discount)}</Td>
          </tr>
        ))}
      </Table>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Justificar días">
          <ActionForm action={justifyAction} submitLabel="Justificar" resetOnSuccess>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm">Desde<input type="date" name="date" required defaultValue={today()} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
              <label className="text-sm">Hasta (opcional)<input type="date" name="to" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
            </div>
            <label className="block text-sm">Empleado
              <select name="employeeId" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2">
                <option value="">Todos (festivo, cierre…)</option>
                {employees.map((e) => <option key={e.id} value={e.id}>{e.employeeNo} · {e.name}</option>)}
              </select>
            </label>
            <input name="reason" required placeholder="Motivo: vacaciones, incapacidad, permiso, festivo…" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          </ActionForm>
        </Card>
        <Card title={`Justificados en la quincena (${justs.length})`}>
          {justs.length === 0 && <p className="text-sm text-slate-500">Ninguno.</p>}
          <ul className="divide-y divide-slate-100 text-sm">
            {justs.map((j) => (
              <li key={j.id} className="flex items-center justify-between py-1.5">
                <span>{j.date.toISOString().slice(0, 10)} · {j.employee?.name ?? "Todos"} · <span className="text-slate-500">{j.reason}</span></span>
                <form action={removeJustification.bind(null, j.id)}><button className="text-xs text-red-600 hover:underline">Quitar</button></form>
              </li>
            ))}
          </ul>
        </Card>
      </div>
      <AdmsCard />
    </div>
  );
}
