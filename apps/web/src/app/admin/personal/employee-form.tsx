import type { Employee } from "@packatelas/db";
import { ActionForm, type ActionState } from "@/components/action-form";
import { Field, Select, TextArea } from "@/components/ui";

const DAYS = ["L", "M", "X", "J", "V", "S", "D"];
const d = (v: Date | null | undefined) => (v ? v.toISOString().slice(0, 10) : "");

export function EmployeeForm({ action, e, submitLabel }: { action: (s: ActionState, fd: FormData) => Promise<ActionState>; e?: Employee | null; submitLabel: string }) {
  const days = e?.workdays ?? [1, 2, 3, 4, 5, 6];
  return (
    <ActionForm action={action} submitLabel={submitLabel}>
      <div className="grid gap-4 sm:grid-cols-4">
        <Field label="No. empleado" name="employeeNo" type="number" min={1} required defaultValue={e?.employeeNo} hint="El ID del ZKTeco" />
        <Field label="Nombre completo" name="name" required defaultValue={e?.name} className="sm:col-span-2" />
        <Select label="Estatus" name="status" defaultValue={e?.status ?? "ACTIVO"}>
          <option value="ACTIVO">Activo</option>
          <option value="BAJA">Baja</option>
        </Select>
      </div>
      <div className="grid gap-4 sm:grid-cols-4">
        <Field label="Puesto" name="position" defaultValue={e?.position ?? ""} />
        <Field label="Área" name="area" defaultValue={e?.area ?? ""} />
        <Field label="Tipo" name="kind" defaultValue={e?.kind ?? ""} hint="repartidor, oficina, bodega…" />
        <Field label="Tipo de moto" name="motoType" defaultValue={e?.motoType ?? ""} hint="propia / empresa, chica / grande" />
      </div>
      <fieldset className="rounded-lg border border-slate-200 p-4">
        <legend className="px-1 text-sm font-medium">Horario</legend>
        <div className="grid gap-4 sm:grid-cols-4">
          <Field label="Hora de entrada" name="entryTime" defaultValue={e?.entryTime ?? "10:00"} placeholder="10:00" />
          <Field label="Minutos de comida" name="lunchMinutes" type="number" min={0} max={240} defaultValue={e?.lunchMinutes ?? 60} />
          <Select label="Checadas al día" name="punchesPerDay" defaultValue={String(e?.punchesPerDay ?? 2)}>
            <option value="2">2 (entrada y salida)</option>
            <option value="4">4 (con comida)</option>
          </Select>
          <div>
            <span className="text-sm font-medium text-slate-700">Días laborales</span>
            <div className="mt-2 flex gap-1">
              {DAYS.map((l, i) => (
                <label key={l} className="flex flex-col items-center text-xs">
                  {l}
                  <input type="checkbox" name="workdays" value={i + 1} defaultChecked={days.includes(i + 1)} className="accent-brand" />
                </label>
              ))}
            </div>
          </div>
        </div>
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-4">
        <Field label="Fecha de ingreso" name="hireDate" type="date" defaultValue={d(e?.hireDate)} />
        <Field label="Fecha de baja" name="endDate" type="date" defaultValue={d(e?.endDate)} />
        <Field label="Salario diario" name="dailySalary" type="number" step="0.01" min={0} defaultValue={e?.dailySalary?.toString() ?? ""} hint="Mensual ÷ 30.5" />
        <Field label="Teléfono" name="phone" inputMode="tel" defaultValue={e?.phone ?? ""} />
      </div>
      <div className="grid gap-4 sm:grid-cols-4">
        <Field label="RFC" name="rfc" defaultValue={e?.rfc ?? ""} />
        <Field label="CURP" name="curp" defaultValue={e?.curp ?? ""} />
        <Field label="NSS" name="nss" defaultValue={e?.nss ?? ""} />
        <Field label="Correo" name="email" type="email" defaultValue={e?.email ?? ""} />
      </div>
      <div className="grid gap-4 sm:grid-cols-4">
        <Field label="CLABE" name="clabe" inputMode="numeric" maxLength={18} defaultValue={e?.clabe ?? ""} className="sm:col-span-2" />
        <Field label="Banco" name="bank" defaultValue={e?.bank ?? ""} />
      </div>
      <Field label="Domicilio" name="address" defaultValue={e?.address ?? ""} />
      <TextArea label="Notas" name="notes" rows={2} defaultValue={e?.notes ?? ""} />
    </ActionForm>
  );
}
