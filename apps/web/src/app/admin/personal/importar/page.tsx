import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { ActionForm } from "@/components/action-form";
import { Card, PageHeader } from "@/components/ui";
import { importEmployeesAction, importPunchesAction } from "../actions";

export const metadata: Metadata = { title: "Importar personal" };
const area = "w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs";

export default async function ImportarPersonalPage() {
  await requireUser(["ADMIN"]);
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader eyebrow="Personal" title="Importar">
        Copia y pega desde el Sheet <span className="font-medium">checador packatelas</span> (con encabezados). Solo se lee: el Sheet, el ZKTeco y el portal actual
        siguen igual. Puedes repetirlo cuando quieras; no duplica.
      </PageHeader>
      <Card title="1. Empleados (pestaña Personal)">
        <ActionForm action={importEmployeesAction} submitLabel="Importar empleados">
          <textarea name="text" rows={8} required className={area} placeholder={"no_empleado\tnombre\trfc\t…\thora_entrada\tdias_laborales\tminutos_comida\tchecadas"} />
          <p className="text-xs text-slate-500">Los PIN y llaves del portal actual no se importan. Si el empleado ya existe (mismo número), se actualizan solo las columnas que pegues.</p>
        </ActionForm>
      </Card>
      <Card title="2. Checadas (pestaña Checadas o exportación del ZKTeco)">
        <ActionForm action={importPunchesAction} submitLabel="Importar checadas">
          <textarea name="text" rows={8} required className={area} placeholder={"UUID\tFecha\tHora\tNo. empleado\tNombre\tTipo\t…"} />
          <p className="text-xs text-slate-500">Primero importa los empleados: las checadas de números que no estén en Personal se reportan y se omiten.</p>
        </ActionForm>
      </Card>
    </div>
  );
}
