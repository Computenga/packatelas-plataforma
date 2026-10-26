"use client";

import { ActionForm } from "@/components/action-form";
import { Field } from "@/components/ui";
import { approveAction, rejectAction } from "../actions";

export function Decide({ appId, nextNo }: { appId: string; nextNo: number }) {
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <ActionForm action={approveAction.bind(null, appId)} submitLabel="Aprobar y crear empleado">
        <Field label="Número de empleado (el del ZKTeco)" name="employeeNo" type="number" min={1} defaultValue={nextNo} required />
        <Field label="Hora de entrada" name="entryTime" type="time" />
      </ActionForm>
      <ActionForm action={rejectAction.bind(null, appId)} submitLabel="Rechazar solicitud">
        <Field label="Motivo" name="note" placeholder="No se presentó, no continuó…" />
      </ActionForm>
    </div>
  );
}
