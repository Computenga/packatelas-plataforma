import Link from "next/link";

/** Encabezado de la pantalla del repartidor (foto, nombre, número, cómo se identificó). */
export function DriverHeader({ mode, driver, via }: { mode: "llegada" | "salida"; driver: { id: string; name: string; employeeNo: number | null; hasPhoto: boolean }; via: string }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3 rounded-xl bg-white p-4">
      <div className="flex items-center gap-4">
        <Link href={`/recepcion?modo=${mode}`} className="rounded-lg border border-slate-300 px-3 py-2 text-lg">←</Link>
        {driver.hasPhoto ? (
          // eslint-disable-next-line @next/next/no-img-element -- foto privada del repartidor
          <img src={`/api/foto-repartidor/${driver.id}`} alt="" className="h-16 w-16 rounded-full object-cover" />
        ) : (
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-slate-200 text-xl font-bold">{driver.name.split(/\s+/).slice(0, 2).map((w) => w[0]).join("")}</span>
        )}
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">{mode === "llegada" ? "☀️ Llegada" : "🛵 Salida a ruta"}</p>
          <p className="text-2xl font-bold">{driver.name}</p>
          <p className="text-sm text-slate-500">Empleado #{driver.employeeNo ?? "—"} · identificado por {via}</p>
        </div>
      </div>
    </div>
  );
}
