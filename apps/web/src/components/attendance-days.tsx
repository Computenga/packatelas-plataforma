import type { AttendanceDay } from "@packatelas/db";
import { Badge } from "./ui";

const DAY = ["", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
export const STATUS: Record<AttendanceDay["status"], { label: string; tone: "green" | "amber" | "red" | "blue" | "gray" }> = {
  a_tiempo: { label: "A tiempo", tone: "green" },
  retardo: { label: "Retardo", tone: "amber" },
  falta: { label: "Falta", tone: "red" },
  justificada: { label: "Justificada", tone: "blue" },
  descanso: { label: "Descanso", tone: "gray" },
  pendiente: { label: "Hoy", tone: "gray" },
  fuera: { label: "—", tone: "gray" },
};

/** Detalle día por día (mismas columnas que "Detalle quincena" del Sheet). */
export function AttendanceDays({ days, showLunch }: { days: AttendanceDay[]; showLunch: boolean }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-3 py-2">Fecha</th><th className="hidden px-3 py-2 sm:table-cell">Debía entrar</th><th className="px-3 py-2">Entró</th><th className="px-3 py-2 text-right">Min. tarde</th>
            {showLunch && <><th className="hidden px-3 py-2 sm:table-cell">Comida</th><th className="px-3 py-2 text-right">Min. extra</th></>}
            <th className="px-3 py-2">Estado</th><th className="hidden px-3 py-2 md:table-cell">Checadas</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {days.filter((d) => d.status !== "fuera").map((d) => (
            <tr key={d.date} className={d.status === "descanso" ? "text-slate-400" : ""}>
              <td className="whitespace-nowrap px-3 py-1.5">{DAY[d.weekday]} {d.date.slice(8)}/{d.date.slice(5, 7)}</td>
              <td className="hidden px-3 py-1.5 sm:table-cell">{d.status === "descanso" ? "" : d.expected ?? "—"}</td>
              <td className="px-3 py-1.5">{d.entry ?? "—"}</td>
              <td className={`px-3 py-1.5 text-right tabular-nums ${d.lateMinutes ? "font-semibold text-amber-700" : ""}`}>{d.lateMinutes || ""}</td>
              {showLunch && (
                <>
                  <td className="hidden px-3 py-1.5 text-xs sm:table-cell">{d.lunchOut ? `${d.lunchOut}–${d.lunchIn} (${d.lunchMinutes} min)` : ""}</td>
                  <td className={`px-3 py-1.5 text-right tabular-nums ${d.extraLunch ? "font-semibold text-amber-700" : ""}`}>{d.extraLunch || ""}</td>
                </>
              )}
              <td className="px-3 py-1.5">
                <Badge tone={STATUS[d.status].tone}>{STATUS[d.status].label}</Badge>
                {d.note && <span className="ml-1 text-xs text-slate-500">{d.note}</span>}
              </td>
              <td className="hidden px-3 py-1.5 font-mono text-xs text-slate-500 md:table-cell">{d.punches.join(" · ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
