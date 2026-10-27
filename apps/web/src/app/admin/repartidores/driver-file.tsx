import Link from "next/link";
import { attendanceReport, employeeFile, prisma, quincenaOf, ymdMx } from "@packatelas/db";
import { ActionForm } from "@/components/action-form";
import { Badge } from "@/components/ui";
import { fecha } from "@/lib/format";
import { linkDriverEmployeeAction } from "./actions";

const mxn = (n: number) => n.toLocaleString("es-MX", { style: "currency", currency: "MXN" });

/** Expediente del repartidor en su tarjeta [A14]: documentos, asistencia, adeudos y moto. */
export async function DriverFile({ driverId, userId }: { driverId: string; userId: string }) {
  const emp = await prisma.employee.findUnique({ where: { userId } });
  if (!emp) {
    const free = await prisma.employee.findMany({ where: { userId: null, status: "ACTIVO" }, orderBy: { employeeNo: "asc" }, select: { id: true, employeeNo: true, name: true } });
    return (
      <div className="mt-5 border-t border-slate-100 pt-4">
        <p className="text-sm font-medium">Expediente</p>
        <p className="mb-2 text-xs text-slate-500">Sin ligar a Personal: no se ven sus documentos, asistencia ni adeudos.</p>
        {free.length > 0 ? (
          <ActionForm action={linkDriverEmployeeAction.bind(null, driverId)} submitLabel="Ligar">
            <select name="employeeId" required defaultValue="" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" aria-label="Empleado">
              <option value="" disabled>Elegir empleado…</option>
              {free.map((e) => <option key={e.id} value={e.id}>#{e.employeeNo} · {e.name}</option>)}
            </select>
          </ActionForm>
        ) : (
          <Link href="/admin/personal" className="text-sm text-brand hover:underline">Dar de alta en Personal →</Link>
        )}
      </div>
    );
  }

  const q = quincenaOf(ymdMx(new Date()));
  const [file, [att], charges, lastCheck] = await Promise.all([
    employeeFile(prisma, emp.id),
    attendanceReport(prisma, q.from, q.to, [emp.id]),
    prisma.employeeCharge.aggregate({ where: { employeeId: emp.id, payrollLine: null }, _sum: { amount: true }, _count: true }),
    prisma.vehicleCheck.findFirst({ where: { employeeId: emp.id }, orderBy: { at: "desc" }, include: { vehicle: { select: { code: true, plate: true } } } }),
  ]);
  const required = file.filter((r) => r.type.required);
  const missing = required.filter((r) => r.doc?.status !== "APROBADO");
  const owed = Number(charges._sum.amount ?? 0);

  return (
    <div className="mt-5 border-t border-slate-100 pt-4 text-sm">
      <div className="flex items-center justify-between">
        <p className="font-medium">Expediente #{emp.employeeNo}</p>
        <Link href={`/admin/personal/${emp.id}`} className="text-xs text-brand hover:underline">Abrir →</Link>
      </div>
      <ul className="mt-2 space-y-1.5">
        <li className="flex items-center justify-between gap-2">
          <span>Documentos</span>
          {missing.length ? <Badge tone="amber">Faltan {missing.length} de {required.length}</Badge> : <Badge tone="green">Completo</Badge>}
        </li>
        <li className="flex items-center justify-between gap-2">
          <Link href={`/admin/checador/${emp.id}?q=${q.key}`} className="hover:underline">Asistencia de la quincena</Link>
          <span className="text-xs text-slate-600">
            {att ? `${att.worked}/${att.workdays} días · ${att.absences} falta(s) · ${att.lateDays} retardo(s)` : "Sin datos"}
          </span>
        </li>
        <li className="flex items-center justify-between gap-2">
          <span>Adeudos por cobrar en nómina</span>
          {owed > 0 ? <Badge tone="red">{mxn(owed)} ({charges._count})</Badge> : <span className="text-xs text-slate-500">Ninguno</span>}
        </li>
        <li className="flex items-center justify-between gap-2">
          <span>Moto</span>
          <span className="text-xs text-slate-600">
            {lastCheck ? `${lastCheck.vehicle.code}${lastCheck.vehicle.plate ? ` · ${lastCheck.vehicle.plate}` : ""} · último check ${fecha(lastCheck.at)}` : "Sin checks registrados"}
          </span>
        </li>
      </ul>
    </div>
  );
}
