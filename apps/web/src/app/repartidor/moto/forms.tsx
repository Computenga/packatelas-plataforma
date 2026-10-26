"use client";

import { useState } from "react";
import { ActionForm } from "@/components/action-form";
import { PhotoSlots } from "@/components/photo-slots";
import { beforeRouteAction, morningCheckAction } from "./actions";

type V = { id: string; code: string; plate: string | null; km: number };
const input = "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-base";

function VehicleSelect({ vehicles, defaultId }: { vehicles: V[]; defaultId?: string }) {
  return (
    <label className="block text-sm font-medium">
      Moto
      <select name="vehicleId" required defaultValue={defaultId ?? ""} className={input}>
        <option value="" disabled>Elige la moto</option>
        {vehicles.map((v) => <option key={v.id} value={v.id}>{v.code}{v.plate ? ` · ${v.plate}` : ""} (último km {v.km.toLocaleString("es-MX")})</option>)}
      </select>
    </label>
  );
}

export function MorningCheckForm({ vehicles, defaultId }: { vehicles: V[]; defaultId?: string }) {
  const [faults, setFaults] = useState(0);
  return (
    <ActionForm action={morningCheckAction} submitLabel="Guardar check matutino">
      <VehicleSelect vehicles={vehicles} defaultId={defaultId} />
      <label className="block text-sm font-medium">Kilometraje del odómetro<input name="km" type="number" inputMode="numeric" min={0} required className={input} /></label>
      <div><p className="mb-1 text-sm font-medium">Fotos de la moto</p><PhotoSlots name="photos" labels={["Frente", "Izquierda", "Derecha", "Atrás"]} min={4} /></div>
      <div><p className="mb-1 text-sm font-medium">Foto del odómetro</p><PhotoSlots name="odometer" labels={["Odómetro"]} /></div>

      <fieldset className="space-y-3 rounded-lg border border-slate-200 p-3">
        <legend className="px-1 text-sm font-medium">Fallas (si hay)</legend>
        {Array.from({ length: faults }, (_, i) => (
          <div key={i} className="space-y-2 border-b border-slate-100 pb-3 last:border-0">
            <input name="faultDesc" required placeholder="Describe la falla" className={input} />
            <select name="faultSev" defaultValue="media" className={input}>
              <option value="baja">Leve: puede circular</option>
              <option value="media">Media: revisar pronto</option>
              <option value="alta">Grave: no debe circular</option>
            </select>
            <PhotoSlots name={`faultPhotos_${i}`} max={2} min={0} />
          </div>
        ))}
        <button type="button" onClick={() => setFaults((n) => Math.min(n + 1, 6))} className="text-sm font-medium text-brand">+ Agregar falla</button>
      </fieldset>

      <fieldset className="space-y-3 rounded-lg border border-slate-200 p-3">
        <legend className="px-1 text-sm font-medium">Gasolina de hoy</legend>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-sm">Monto ($)<input name="fuelAmount" type="number" step="0.01" min={0} inputMode="decimal" className={input} /></label>
          <label className="text-sm">Litros<input name="fuelLiters" type="number" step="0.01" min={0} inputMode="decimal" className={input} /></label>
        </div>
        <PhotoSlots name="ticket" labels={["Ticket"]} min={0} />
      </fieldset>
    </ActionForm>
  );
}

export function BeforeRouteForm({ vehicles, defaultId }: { vehicles: V[]; defaultId?: string }) {
  return (
    <ActionForm action={beforeRouteAction} submitLabel="Reportar daño" resetOnSuccess>
      <p className="text-sm text-slate-600">Si al recibir la moto encuentras un daño que no se reportó en el check de la mañana, repórtalo antes de salir a ruta.</p>
      <VehicleSelect vehicles={vehicles} defaultId={defaultId} />
      <textarea name="description" required minLength={5} rows={2} placeholder="¿Qué daño encontraste?" className={input} />
      <select name="severity" defaultValue="media" className={input}>
        <option value="baja">Leve</option>
        <option value="media">Media</option>
        <option value="alta">Grave</option>
      </select>
      <PhotoSlots name="photos" max={4} min={1} />
    </ActionForm>
  );
}
