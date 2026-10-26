import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { DriverScan } from "./driver-scan";

export const metadata: Metadata = { title: "Escanear" };

export default async function RepartidorEscanear() {
  await requireUser(["REPARTIDOR"]);
  return (
    <div>
      <h1 className="mb-1 text-lg font-bold">Escanear al cargar</h1>
      <p className="mb-4 text-sm text-slate-600">Escanea cada paquete que subes a la moto. Si no está registrado, podrás darlo de alta.</p>
      <DriverScan />
    </div>
  );
}
