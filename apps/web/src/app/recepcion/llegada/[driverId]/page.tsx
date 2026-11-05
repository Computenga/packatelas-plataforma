import type { Metadata } from "next";
import { gateExpected, prisma } from "@packatelas/db";
import { DriverHeader } from "../../driver-header";
import { loadGateDriver } from "../../load-driver";
import { SoundGate } from "../../sound-gate";
import { Arrival } from "./arrival";

export const metadata: Metadata = { title: "Llegada · Recepción" };

export default async function LlegadaPage({ params, searchParams }: PageProps<"/recepcion/llegada/[driverId]">) {
  const { driverId } = await params;
  const via = String((await searchParams).via ?? "lista").slice(0, 40);
  const driver = await loadGateDriver(driverId);
  if (!driver.active) return <p className="rounded-xl bg-slate-800 p-6 text-xl font-bold text-white">⛔ {driver.name} está dado de baja: SIN ACCESO</p>;
  const expected = await gateExpected(prisma, driverId);
  return (
    <>
      <SoundGate />
      <DriverHeader mode="llegada" driver={driver} via={via} />
      <Arrival driverId={driverId} via={via} expected={expected} />
    </>
  );
}
