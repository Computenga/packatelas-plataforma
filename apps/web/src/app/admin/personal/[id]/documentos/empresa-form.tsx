"use client";
import { useActionState } from "react";
import { Button, Field } from "@/components/ui";
import type { Empresa } from "@/lib/rh-text";
import { saveEmpresaAction } from "./actions";

const LABELS: Record<keyof Empresa, string> = {
  razonSocial: "Razón social", rfc: "RFC", tipoPersona: "Tipo de persona (moral/física)", domicilio: "Domicilio", repLegal: "Representante legal",
  lugarFirma: "Lugar de firma", periodicidad: "Periodicidad de pago", diasPago: "Días de pago", lugarPago: "Forma/lugar de pago",
  jornada: "Jornada", horaEntrada: "Hora de entrada", horaSalida: "Hora de salida", descanso: "Descanso", diaInicio: "Día inicio de semana",
  diaFin: "Día fin de semana", diasDescanso: "Días de descanso", tarifaKm: "Tarifa por km (moto propia)", plazoConfidencialidad: "Plazo de confidencialidad",
  plazoNoSolicitacion: "Plazo de no solicitación", plazoAvisoRenuncia: "Aviso de renuncia", plazoPagoFiniquito: "Pago de finiquito",
  plazoAbandono: "Abandono de empleo", plazoEntregaIncapacidad: "Entrega de incapacidad", plazoEntregaEfectivo: "Entrega de efectivo",
};

export function EmpresaForm({ empresa }: { empresa: Empresa }) {
  const [state, action, pending] = useActionState(saveEmpresaAction, null);
  return (
    <details>
      <summary className="cursor-pointer text-sm text-slate-600">Editar (aplica a todos los contratos nuevos)</summary>
      <form action={action} className="mt-4 grid gap-3 sm:grid-cols-2">
        {(Object.keys(LABELS) as (keyof Empresa)[]).map((k) => (
          <Field key={k} name={k} label={LABELS[k]} defaultValue={empresa[k]} className={k === "domicilio" || k === "lugarPago" ? "sm:col-span-2" : ""} />
        ))}
        <div className="flex items-center gap-3 sm:col-span-2">
          <Button disabled={pending}>{pending ? "Guardando…" : "Guardar"}</Button>
          {state?.message && <span className="text-sm text-green-700">{state.message}</span>}
        </div>
      </form>
    </details>
  );
}
