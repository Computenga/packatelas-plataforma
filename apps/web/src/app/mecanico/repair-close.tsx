"use client";

import { useState } from "react";
import { ActionForm } from "@/components/action-form";
import { PhotoSlots } from "@/components/photo-slots";
import { closeRepairAction } from "./actions";

const input = "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm";

export function RepairClose({ repairId, employees, responsibleId }: { repairId: string; employees: { id: string; label: string }[]; responsibleId: string | null }) {
  const [cause, setCause] = useState("desgaste");
  return (
    <ActionForm action={closeRepairAction.bind(null, repairId)} submitLabel="Cerrar reparación">
      <textarea name="description" required rows={2} placeholder="¿Qué se hizo?" className={input} />
      <div className="grid grid-cols-2 gap-2">
        <label className="text-sm">Refacciones ($)<input name="partsCost" type="number" step="0.01" min={0} defaultValue={0} className={input} /></label>
        <label className="text-sm">Mano de obra ($)<input name="laborCost" type="number" step="0.01" min={0} defaultValue={0} className={input} /></label>
      </div>
      <label className="block text-sm">Causa
        <select name="cause" value={cause} onChange={(e) => setCause(e.target.value)} className={input}>
          <option value="desgaste">Desgaste: paga la empresa</option>
          <option value="mal_uso">Mal uso: paga el empleado</option>
          <option value="ambos">Ambos (por acuerdo)</option>
        </select>
      </label>
      {cause !== "desgaste" && (
        <div className="grid grid-cols-2 gap-2">
          <label className="text-sm">Empleado que paga
            <select name="responsibleId" required defaultValue={responsibleId ?? ""} className={input}>
              <option value="" disabled>Elige</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
            </select>
          </label>
          <label className="text-sm">{cause === "ambos" ? "Monto del empleado ($)" : "Monto (vacío = total)"}
            <input name="employeeAmount" type="number" step="0.01" min={0} required={cause === "ambos"} className={input} />
          </label>
        </div>
      )}
      <PhotoSlots name="photos" max={4} min={1} />
      <p className="text-xs text-slate-500">La parte del empleado se registra como adeudo y él la ve en su app.</p>
    </ActionForm>
  );
}
