import type { Metadata } from "next";
import { packagesToReturn, prisma } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import { fecha, startOfTodayMx } from "@/lib/format";
import { toggleShift } from "./actions";
import { RouteList } from "./route-list";

export const metadata: Metadata = { title: "Mi ruta" };

export default async function RepartidorHome() {
  const user = await requireUser(["REPARTIDOR"]);
  const driver = await prisma.driver.findUnique({ where: { userId: user.id } });
  if (!driver) {
    return <p className="text-slate-600">Tu usuario aún no tiene perfil de repartidor. Avisa a tu supervisor.</p>;
  }
  const today = startOfTodayMx();
  // Resumen del día [R12]: lo que cerró él hoy (aunque lo haya enviado sin señal).
  const [toReturn, dayEvents, inRoute, pickupsDone] = await Promise.all([
    packagesToReturn(prisma, driver.id),
    prisma.orderEvent.groupBy({
      by: ["type"],
      where: { actorUserId: user.id, type: { in: ["delivered", "failed"] }, occurredAt: { gte: today } },
      _count: { _all: true },
    }),
    prisma.order.count({ where: { driverId: driver.id, status: { in: ["ASSIGNED", "OUT_FOR_DELIVERY"] } } }),
    prisma.pickup.aggregate({
      where: { driverId: driver.id, status: "COLLECTED", collectedAt: { gte: today } },
      _count: { _all: true },
      _sum: { collectedCount: true },
    }),
  ]);
  const delivered = dayEvents.find((e) => e.type === "delivered")?._count._all ?? 0;
  const failedToday = dayEvents.find((e) => e.type === "failed")?._count._all ?? 0;
  const done = delivered + failedToday;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <div>
          <p className="font-semibold">Hola, {user.name.split(" ")[0]}</p>
          <p className={`text-sm ${driver.onDuty ? "text-emerald-600" : "text-slate-500"}`}>
            {driver.onDuty ? `En turno desde ${fecha(driver.shiftStartedAt)}` : "Fuera de turno"}
          </p>
        </div>
        <form action={toggleShift}>
          <button
            className={`rounded-lg px-4 py-2.5 text-sm font-semibold ${driver.onDuty ? "border border-slate-300 bg-white text-slate-700" : "bg-emerald-600 text-white"}`}
          >
            {driver.onDuty ? "Terminar turno" : "Iniciar turno"}
          </button>
        </form>
      </div>
      <section aria-label="Mi día" className="mb-4 grid grid-cols-4 gap-2 text-center">
        {[
          { label: "Entregados", value: delivered, cls: "text-emerald-700" },
          { label: "No entregados", value: failedToday, cls: failedToday ? "text-amber-700" : "text-slate-900" },
          { label: "Pendientes", value: inRoute, cls: "text-slate-900" },
          { label: "Recolecciones", value: pickupsDone._count._all, cls: "text-slate-900", hint: pickupsDone._sum.collectedCount ? `${pickupsDone._sum.collectedCount} paq.` : undefined },
        ].map((x) => (
          <div key={x.label} className="rounded-xl border border-slate-200 bg-white px-1 py-2">
            <p className={`text-xl font-bold ${x.cls}`}>{x.value}</p>
            <p className="text-[11px] leading-tight text-slate-500">{x.label}</p>
            {x.hint && <p className="text-[10px] text-slate-400">{x.hint}</p>}
          </div>
        ))}
      </section>
      {done > 0 && (
        <p className="-mt-2 mb-4 text-center text-xs text-slate-500">
          Efectividad de hoy: {Math.round((delivered / done) * 100)}% ({delivered} de {done})
        </p>
      )}
      {driver.onDuty && toReturn.length > 0 && (
        <p className="-mt-2 mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Antes de terminar tu turno deja en bodega los {toReturn.length} paquete(s) de abajo.
        </p>
      )}
      <RouteList />
      {toReturn.length > 0 && (
        <section className="mt-6 rounded-xl border border-amber-200 bg-white">
          <h2 className="border-b border-amber-100 px-4 py-3 font-semibold text-amber-900">Llevar a bodega ({toReturn.length})</h2>
          <ul className="divide-y divide-slate-100 text-sm">
            {toReturn.map((o) => (
              <li key={o.id} className="px-4 py-2">
                <span className="font-mono text-xs">{o.code}</span>
                <span className="ml-2 text-xs text-slate-500">{o.status === "RETURNING" ? "Regresar a bodega" : "No entregado"}</span>
                <span className="block truncate text-slate-700">{o.client.name} · {o.recipientName ?? o.addressLine}</span>
              </li>
            ))}
          </ul>
          <p className="px-4 pb-3 text-xs text-slate-500">En bodega lo escanean al recibirlo y sale de esta lista.</p>
        </section>
      )}
    </div>
  );
}
