import type { Metadata } from "next";
import { gateRouteCount, prisma } from "@packatelas/db";
import { DriverHeader } from "../../driver-header";
import { loadGateDriver } from "../../load-driver";
import { SoundGate } from "../../sound-gate";
import { Departure } from "./departure";

export const metadata: Metadata = { title: "Salida · Recepción" };

export default async function SalidaPage({ params, searchParams }: PageProps<"/recepcion/salida/[driverId]">) {
  const { driverId } = await params;
  const via = String((await searchParams).via ?? "lista").slice(0, 40);
  const driver = await loadGateDriver(driverId);
  if (!driver.active) return <p className="rounded-xl bg-slate-800 p-6 text-xl font-bold text-white">⛔ {driver.name} está dado de baja: SIN ACCESO</p>;
  const count = await gateRouteCount(prisma, driverId);
  return (
    <>
      <SoundGate />
      <DriverHeader mode="salida" driver={driver} via={via} />
      <Departure driverId={driverId} via={via} count={count} />
    </>
  );
}
