import type { Metadata } from "next";
import { prisma, type Vehicle } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import { ActionForm } from "@/components/action-form";
import { Badge, Card } from "@/components/ui";
import { saveVehicleAction } from "../actions";

export const metadata: Metadata = { title: "Motos" };
const inp = "w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm";

function VehicleFields({ v }: { v?: Vehicle }) {
  return (
    <div className="grid gap-2 sm:grid-cols-6">
      <label className="text-xs text-slate-500">ID<input name="code" required defaultValue={v?.code ?? ""} placeholder="M-01" className={inp} /></label>
      <label className="text-xs text-slate-500">Placa<input name="plate" defaultValue={v?.plate ?? ""} className={inp} /></label>
      <label className="text-xs text-slate-500">Marca<input name="brand" defaultValue={v?.brand ?? ""} className={inp} /></label>
      <label className="text-xs text-slate-500">Modelo<input name="model" defaultValue={v?.model ?? ""} className={inp} /></label>
      <label className="text-xs text-slate-500">Año<input name="year" type="number" defaultValue={v?.year ?? ""} className={inp} /></label>
      <label className="text-xs text-slate-500">Km<input name="km" type="number" min={0} required defaultValue={v?.km ?? 0} className={inp} /></label>
      <label className="text-xs text-slate-500">Tamaño<select name="size" defaultValue={v?.size ?? "grande"} className={inp}><option value="grande">Grande</option><option value="chica">Chica (solo CDMX)</option></select></label>
      <label className="text-xs text-slate-500">Propiedad<select name="ownership" defaultValue={v?.ownership ?? "empresa"} className={inp}><option value="empresa">Empresa</option><option value="propia">Propia</option></select></label>
      <label className="text-xs text-slate-500">Estatus<select name="status" defaultValue={v?.status ?? "ACTIVO"} className={inp}><option value="ACTIVO">Activa</option><option value="TALLER">En taller</option><option value="BAJA">Baja</option></select></label>
      <label className="text-xs text-slate-500">Color<input name="color" defaultValue={v?.color ?? ""} className={inp} /></label>
      <label className="text-xs text-slate-500 sm:col-span-2">No. de serie<input name="vin" defaultValue={v?.vin ?? ""} className={inp} /></label>
      <label className="text-xs text-slate-500 sm:col-span-6">Notas<input name="notes" defaultValue={v?.notes ?? ""} className={inp} /></label>
    </div>
  );
}

export default async function MotosPage() {
  await requireUser(["MECANICO", "ADMIN"]);
  const vehicles = await prisma.vehicle.findMany({ orderBy: { code: "asc" } });
  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <h1 className="text-xl font-bold">Motos ({vehicles.length})</h1>
      {vehicles.map((v) => (
        <details key={v.id} className="rounded-xl border border-slate-200 bg-white">
          <summary className="flex cursor-pointer items-center justify-between px-4 py-3 text-sm">
            <span><span className="font-semibold">{v.code}</span> · {[v.plate, v.brand, v.model].filter(Boolean).join(" ")} · {v.km.toLocaleString("es-MX")} km · {v.size}</span>
            <Badge tone={v.status === "ACTIVO" ? "green" : v.status === "TALLER" ? "amber" : "gray"}>{v.status === "ACTIVO" ? "Activa" : v.status === "TALLER" ? "En taller" : "Baja"}</Badge>
          </summary>
          <div className="border-t border-slate-100 p-4">
            <ActionForm action={saveVehicleAction.bind(null, v.id)} submitLabel="Guardar"><VehicleFields v={v} /></ActionForm>
          </div>
        </details>
      ))}
      <Card title="Nueva moto">
        <ActionForm action={saveVehicleAction.bind(null, null)} submitLabel="Dar de alta" resetOnSuccess><VehicleFields /></ActionForm>
      </Card>
    </div>
  );
}
