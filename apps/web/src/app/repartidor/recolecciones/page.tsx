import type { Metadata } from "next";
import { prisma } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import { PICKUP_LABEL, soloFecha } from "@/lib/format";
import { ActionForm } from "@/components/action-form";
import { Badge, Field } from "@/components/ui";
import { completePickupAction } from "./actions";

export const metadata: Metadata = { title: "Recolecciones" };

export default async function RepartidorRecolecciones() {
  const user = await requireUser(["REPARTIDOR"]);
  const driver = await prisma.driver.findUnique({ where: { userId: user.id } });
  if (!driver) return null;
  const pickups = await prisma.pickup.findMany({
    where: { driverId: driver.id, status: "ASSIGNED" },
    include: { client: { select: { name: true } }, branch: true },
    orderBy: { scheduledFor: "asc" },
  });

  return (
    <div className="space-y-3">
      <h1 className="text-lg font-bold">Recolecciones ({pickups.length})</h1>
      {pickups.length === 0 && (
        <p className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">No tienes recolecciones asignadas.</p>
      )}
      {pickups.map((p) => {
        const dest = p.branch.lat != null ? `${p.branch.lat},${p.branch.lng}` : encodeURIComponent(p.branch.address);
        return (
          <div key={p.id} className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-semibold">{p.client.name}</p>
                <p className="text-sm text-slate-600">{p.branch.name} · {p.branch.address}</p>
                <p className="text-xs text-slate-500">
                  {soloFecha(p.scheduledFor)}
                  {p.expectedCount && ` · ~${p.expectedCount} paquetes`}
                  {p.note && ` · ${p.note}`}
                </p>
              </div>
              <Badge tone={PICKUP_LABEL[p.status][1]}>{PICKUP_LABEL[p.status][0]}</Badge>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-center text-sm">
              <a className="rounded-lg border border-slate-300 py-2" href={`https://www.google.com/maps/dir/?api=1&destination=${dest}`} target="_blank" rel="noreferrer">Google Maps</a>
              {p.branch.phone ? <a className="rounded-lg border border-slate-300 py-2" href={`tel:${p.branch.phone}`}>Llamar</a> : <span className="rounded-lg border border-slate-200 py-2 text-slate-400">Sin teléfono</span>}
            </div>
            <div className="mt-3">
              <ActionForm action={completePickupAction.bind(null, p.id)} submitLabel="Confirmar recolección">
                <Field label="¿Cuántos paquetes recogiste?" name="count" type="number" min="0" inputMode="numeric" required />
                <Field label="Nota" name="note" />
              </ActionForm>
              <details className="mt-2 text-sm">
                <summary className="cursor-pointer text-red-600">No se pudo recolectar</summary>
                <ActionForm action={completePickupAction.bind(null, p.id)} submitLabel="Reportar" className="mt-2">
                  <input type="hidden" name="failed" value="1" />
                  <Field label="Motivo" name="note" required />
                </ActionForm>
              </details>
            </div>
          </div>
        );
      })}
    </div>
  );
}
