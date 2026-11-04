import type { Metadata } from "next";
import Link from "next/link";
import { driveConnection, getDriveCopyState, getLegacyConfig, getLegacyStatus, prisma } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import { fecha } from "@/lib/format";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, PageHeader } from "@/components/ui";
import { copyFilesNowAction, cutoverAction, saveConfigAction, syncNowAction } from "./actions";

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
  const [copyState, driveDocs, fleetPhotos] = await Promise.all([
    getDriveCopyState(prisma),
    prisma.employeeDocument.count({ where: { fileKey: { startsWith: "drive:" } } }),
    Promise.all([prisma.vehicleCheck.findMany({ select: { photos: true } }), prisma.fault.findMany({ select: { photos: true } }), prisma.repair.findMany({ select: { photos: true } })]),
  ]);
  const driveFleet = fleetPhotos.flat().reduce((n, r) => n + r.photos.filter((p) => /^https?:/.test(p)).length, 0);
  const failedCount = Object.keys(copyState.failed).length;
  const filesLeft = Math.max(0, driveDocs + driveFleet - failedCount);
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader eyebrow="Importar y exportar" title="Unificación: RH, checador y flotilla">
        La plataforma copia cada 10 minutos lo nuevo de las hojas del sistema actual (checador ZKTeco → Sheets, portal de empleados y app de flotilla).
        Solo lee: nunca escribe en las hojas, así que el sistema actual sigue funcionando igual y queda como consulta y respaldo.
      </PageHeader>

      <Card title="Cómo es la transición">
        <ol className="list-decimal space-y-1.5 pl-5 text-sm text-slate-700">
          <li><strong>Espejo:</strong> todo lo de las hojas ya está aquí y se mantiene al día cada 10 minutos.</li>
          <li><strong>Archivos:</strong> expedientes y fotos de flotilla se traen de Drive al servidor solos (abajo ves el avance).</li>
          <li><strong>Corte:</strong> el ZKTeco se apunta a la plataforma (Checador → Recepción directa), el personal entra con su RFC en portal.packatelas.mx/acceso/empleado y se da «Hacer el corte»: última copia y se apaga. Las hojas quedan intactas como archivo histórico.</li>
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

      <Card title="Archivos de Drive → servidor" actions={filesLeft > 0 ? <ActionForm action={copyFilesNowAction} submitLabel="Copiar una tanda ahora"><span /></ActionForm> : undefined}>
        <p className="text-sm">
          {filesLeft > 0 ? <Badge tone="amber">{filesLeft} por traer</Badge> : <Badge tone="green">Al día</Badge>}{" "}
          {copyState.copied} copiados al servidor{failedCount ? ` · ${failedCount} se quedan como liga a Drive (no se pudieron bajar)` : ""}
          {copyState.at && <span className="text-slate-500"> · última tanda {fecha(new Date(copyState.at))}</span>}
        </p>
        {copyState.lastError && <p className="mt-2 rounded bg-red-50 px-2 py-1 text-sm text-red-700">{copyState.lastError}</p>}
        <p className="mt-2 text-xs text-slate-500">Se copian solos de 40 en 40 cada 3 minutos. Los que no se pueden bajar (borrados, sin permiso o fotos HEIC) siguen abriendo en Drive.</p>
        {failedCount > 0 && (
          <details className="mt-2 text-xs text-slate-500"><summary className="cursor-pointer">Ver cuáles</summary>
            <ul className="mt-1 space-y-0.5">{Object.entries(copyState.failed).slice(0, 50).map(([id, why]) => <li key={id}><a href={`https://drive.google.com/file/d/${id}/view`} target="_blank" rel="noreferrer" className="font-mono text-brand">{id.slice(0, 12)}…</a> {why}</li>)}</ul>
          </details>
        )}
      </Card>

      <Card title="Corte final">
        {cfg.enabled ? (
          <>
            <p className="mb-3 text-sm text-slate-600">
              Hazlo cuando el ZKTeco ya mande sus checadas aquí y repartidores y mecánico usen el portal. Hace una última copia de las hojas y apaga la copia automática.
              Si alguien sigue registrando en lo anterior, ya no llegará aquí.
            </p>
            <ActionForm action={cutoverAction} submitLabel="Hacer el corte"><span /></ActionForm>
          </>
        ) : (
          <p className="text-sm"><Badge tone="green">Hecho</Badge> La copia está apagada: todo se maneja desde el portal. Las hojas quedan como archivo histórico.</p>
        )}
      </Card>
    </div>
  );
}
