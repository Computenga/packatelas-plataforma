import type { Metadata } from "next";
import Link from "next/link";
import { driveConnection, getLegacyConfig, getLegacyStatus, prisma } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import { fecha } from "@/lib/format";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, PageHeader } from "@/components/ui";
import { saveConfigAction, syncNowAction } from "./actions";

export const metadata: Metadata = { title: "Unificación RH, checador y flotilla" };

const LABEL: Record<string, string> = {
  empleados: "Personal", checadas: "Checadas", justificadas: "Días justificados", recibos: "Recibos de nómina", expedientes: "Expedientes", vehiculos: "Motos", checks: "Checks", gasolina: "Cargas de gasolina",
  fallas: "Fallas", reparaciones: "Reparaciones", documentos: "Documentos", omitidos: "Omitidos", estado: "Estado",
};

/** [A37] Copia continua desde las hojas del sistema actual, que sigue funcionando como respaldo. */
export default async function UnificacionPage() {
  await requireUser(["ADMIN"]);
  const [cfg, st, drive, counts] = await Promise.all([
    getLegacyConfig(prisma),
    getLegacyStatus(prisma),
    driveConnection(prisma),
    Promise.all([prisma.employee.count(), prisma.punch.count(), prisma.vehicle.count(), prisma.vehicleCheck.count(), prisma.fault.count(), prisma.repair.count()]),
  ]);
  const [emp, pun, veh, chk, flt, rep] = counts;
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader eyebrow="Importar y exportar" title="Unificación: RH, checador y flotilla">
        La plataforma copia cada 10 minutos lo nuevo de las hojas del sistema actual (checador ZKTeco → Sheets, portal de empleados y app de flotilla).
        Solo lee: nunca escribe en las hojas, así que el sistema actual sigue funcionando igual y queda como consulta y respaldo.
      </PageHeader>

      <Card title="Cómo es la transición">
        <ol className="list-decimal space-y-1.5 pl-5 text-sm text-slate-700">
          <li><strong>Ahora (espejo):</strong> todos siguen usando lo de siempre; aquí se va llenando solo. Compara números (faltas, retardos, costos de flotilla) entre ambos.</li>
          <li><strong>Cuando cuadre:</strong> repartidores y mecánico pasan a la app de la plataforma (pestaña Moto y /mecanico) y el ZKTeco se apunta a la plataforma (Checador → ADMS). La copia sigue trayendo lo que alguien registre todavía en lo anterior.</li>
          <li><strong>Al final:</strong> se apaga la copia; las hojas quedan intactas como archivo histórico.</li>
        </ol>
      </Card>

      <Card title="Configuración">
        {!drive.connected && (
          <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Primero conecta Google Drive en <Link href="/admin/salud" className="underline">Salud</Link> con la cuenta dueña de las hojas.
          </p>
        )}
        {drive.connected && (
          <p className="mb-3 text-xs text-slate-500">
            Lee con la cuenta {drive.email}. Si al copiar dice «falta permiso para leer las hojas», vuelve a dar «Conectar Google Drive» en Salud (ahora también pide lectura de hojas).
          </p>
        )}
        <ActionForm action={saveConfigAction} submitLabel="Guardar">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="enabled" defaultChecked={cfg.enabled} className="h-4 w-4 accent-brand" /> Copiar automáticamente cada 10 minutos</label>
          <label className="block text-sm"><span className="text-slate-600">Hoja del checador y portal de empleados (Personal, Empleados, Checadas, Justificadas, Recibos, DocsEmpleado)</span>
            <input name="checador" defaultValue={cfg.checadorSheetId} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs" /></label>
          <label className="block text-sm"><span className="text-slate-600">Hoja de la flotilla (Vehiculos, Checks, Combustible, Fallas, Reparaciones, Documentos)</span>
            <input name="flotilla" defaultValue={cfg.flotillaSheetId} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs" /></label>
        </ActionForm>
      </Card>

      <Card title="Última copia" actions={<ActionForm action={syncNowAction} submitLabel="Copiar ahora"><span /></ActionForm>}>
        {st ? (
          <div className="text-sm">
            <p className="mb-2">
              <Badge tone={st.ok ? "green" : "red"}>{st.ok ? "Bien" : "Con errores"}</Badge> <span className="text-slate-500">{fecha(new Date(st.at))}</span>
            </p>
            {st.errors.map((e) => <p key={e} className="mb-1 rounded bg-red-50 px-2 py-1 text-red-700">{e}</p>)}
            <dl className="grid grid-cols-[160px_1fr] gap-1">
              {Object.entries(st.results).map(([k, v]) => (
                <div key={k} className="contents"><dt className="text-slate-500">{LABEL[k] ?? k}</dt><dd>{v}</dd></div>
              ))}
            </dl>
          </div>
        ) : (
          <p className="text-sm text-slate-500">Aún no se ha copiado nada.</p>
        )}
        <p className="mt-3 text-xs text-slate-500">En la plataforma hoy: {emp} empleados · {pun} checadas · {veh} motos · {chk} checks · {flt} fallas · {rep} reparaciones.</p>
      </Card>
    </div>
  );
}
