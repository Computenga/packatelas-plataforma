import type { Metadata } from "next";
import { prisma } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import { Stat } from "@/components/stat";

export const metadata: Metadata = { title: "Mi ruta" };

export default async function RepartidorHome() {
  const user = await requireUser(["REPARTIDOR"]);
  const driver = await prisma.driver.findUnique({ where: { userId: user.id } });
  if (!driver) {
    return <p className="text-slate-600">Tu usuario aún no tiene perfil de repartidor. Avisa a tu supervisor.</p>;
  }

  const [pending, delivered] = await Promise.all([
    prisma.order.count({ where: { driverId: driver.id, status: { in: ["ASSIGNED", "OUT_FOR_DELIVERY"] } } }),
    prisma.order.count({ where: { driverId: driver.id, status: "DELIVERED" } }),
  ]);

  return (
    <div className="mx-auto max-w-md">
      <h1 className="text-xl font-bold">Hola, {user.name.split(" ")[0]}</h1>
      <p className={`mt-1 text-sm ${driver.onDuty ? "text-emerald-600" : "text-slate-500"}`}>
        {driver.onDuty ? "En turno" : "Fuera de turno"}
      </p>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <Stat label="Por entregar" value={pending} tone="amber" />
        <Stat label="Entregados" value={delivered} tone="green" />
      </div>
      <p className="mt-6 rounded-xl border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-600">
        Pronto: inicio de turno, ruta ordenada por tu ubicación, escaneo y entregas sin conexión.
      </p>
    </div>
  );
}
