import { attendanceReport, prisma } from "@packatelas/db";
import { getSessionUser } from "@/lib/session";
import { readQuincena } from "@/lib/quincena";

const cell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/** CSV de la quincena: resumen por empleado y detalle por día. */
export async function GET(request: Request) {
  const user = await getSessionUser();
  if (user?.role !== "ADMIN") return new Response("No autorizado", { status: 401 });
  const q = readQuincena(new URL(request.url).searchParams.get("q"));
  const rows = await attendanceReport(prisma, q.from, q.to);
  const lines = [["No.", "Empleado", "Fecha", "Debía entrar", "Entró", "Min. tarde", "Salió a comer", "Regresó", "Min. comida", "Min. extra comida", "Estado", "Nota"].map(cell).join(",")];
  for (const r of rows) {
    for (const d of r.days.filter((x) => x.status !== "fuera" && x.status !== "descanso")) {
      lines.push([r.employee.employeeNo, r.employee.name, d.date, d.expected, d.entry, d.lateMinutes, d.lunchOut, d.lunchIn, d.lunchMinutes, d.extraLunch, d.status, d.note].map(cell).join(","));
    }
    lines.push([r.employee.employeeNo, r.employee.name, "TOTAL", "", "", r.lateMinutes, "", "", "", r.extraLunchMinutes, `${r.absences} falta(s)`, r.discount == null ? "" : `descuento ${r.discount.toFixed(2)}`].map(cell).join(","));
  }
  return new Response("﻿" + lines.join("\r\n"), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="asistencia-${q.key}.csv"` },
  });
}
