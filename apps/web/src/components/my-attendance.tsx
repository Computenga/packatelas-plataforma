import Link from "next/link";
import { attendanceReport, prisma, shiftQuincena } from "@packatelas/db";
import { readQuincena } from "@/lib/quincena";
import { AttendanceDays } from "./attendance-days";
import { Stat } from "./stat";

/** Asistencia propia de la quincena, para el portal del empleado y la app del repartidor [A25]. */
export async function MyAttendance({ userId, q: rawQ, base }: { userId: string; q: unknown; base: string }) {
  const emp = await prisma.employee.findUnique({ where: { userId }, select: { id: true } });
  if (!emp) {
    return <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">Tu usuario aún no está ligado a tu expediente. Pídelo en oficina.</p>;
  }
  const q = readQuincena(rawQ);
  const [r] = await attendanceReport(prisma, q.from, q.to, [emp.id]);
  const prev = shiftQuincena(q.key, -1), next = shiftQuincena(q.key, 1);
  if (!r) return null;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 text-sm">
        <Link href={`${base}?q=${prev.key}`} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5">←</Link>
        <span className="text-center font-semibold">{q.label}</span>
        <Link href={`${base}?q=${next.key}`} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5">→</Link>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Faltas" value={r.absences} tone={r.absences ? "red" : "green"} />
        <Stat label="Min. tarde" value={r.lateMinutes} tone={r.lateMinutes ? "amber" : "green"} hint={`${r.lateDays} retardo(s)`} />
        <Stat label="Justificadas" value={r.justified} />
      </div>
      <p className="text-xs text-slate-500">Hora de entrada: {r.employee.entryTime ?? "sin definir"}. Si algo no cuadra, avisa en oficina antes del cierre de la quincena.</p>
      <AttendanceDays days={r.days} showLunch={r.employee.punchesPerDay >= 4} />
    </div>
  );
}
