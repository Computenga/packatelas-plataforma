import type { Metadata } from "next";
import { prisma } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import { fecha } from "@/lib/format";
import { toggleShift } from "./actions";
import { RouteList } from "./route-list";

export const metadata: Metadata = { title: "Mi ruta" };

export default async function RepartidorHome() {
  const user = await requireUser(["REPARTIDOR"]);
  const driver = await prisma.driver.findUnique({ where: { userId: user.id } });
  if (!driver) {
    return <p className="text-slate-600">Tu usuario aún no tiene perfil de repartidor. Avisa a tu supervisor.</p>;
  }

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
      <RouteList />
    </div>
  );
}
