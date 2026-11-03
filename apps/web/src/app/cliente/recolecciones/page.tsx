import type { Metadata } from "next";
import { earliestPickupDate, pickupDayLabel, prisma, PICKUP_RULE_TEXT } from "@packatelas/db";
import { requireClient } from "@/lib/client-scope";
import { PICKUP_LABEL, soloFecha } from "@/lib/format";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, Field, Select } from "@/components/ui";
import { requestPickupAction } from "./actions";

export const metadata: Metadata = { title: "Recolecciones" };

export default async function ClienteRecolecciones() {
  const { clientId } = await requireClient();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date());
  const earliest = earliestPickupDate();
  const [branches, pickups] = await Promise.all([
    prisma.branch.findMany({ where: { clientId, active: true }, orderBy: { name: "asc" } }),
    prisma.pickup.findMany({ where: { clientId }, include: { branch: { select: { name: true } } }, orderBy: { scheduledFor: "desc" }, take: 60 }),
  ]);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-xl font-bold">Recolecciones</h1>
      <div role="note" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <p className="font-semibold">🕛 Horario de recolecciones</p>
        <p>{PICKUP_RULE_TEXT}</p>
        <p className="mt-1">
          Si la pides ahora, lo más pronto es el <strong>{pickupDayLabel(earliest)}</strong>{earliest === today ? " (hoy)" : ""}.
        </p>
      </div>
      <Card title="Solicitar recolección">
        <ActionForm action={requestPickupAction} submitLabel="Solicitar" resetOnSuccess>
          <Select label="Sucursal" name="branchId" required defaultValue={branches[0]?.id}>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>{b.name} · {b.address}</option>
            ))}
          </Select>
          <Field label="Fecha" name="date" type="date" min={earliest} defaultValue={earliest} required hint="Lunes a sábado · una recolección por sucursal al día" />
          <Field label="Nota para el repartidor" name="note" />
        </ActionForm>
      </Card>
      <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white text-sm">
        {pickups.map((p) => (
          <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-3">
            <span>
              <span className="font-medium">{soloFecha(p.scheduledFor)}</span> · {p.branch.name}
              <span className="block text-xs text-slate-500">
                {p.automatic ? "Automática" : "Solicitada"}
                {p.collectedCount != null && ` · ${p.collectedCount} paquete(s) recogidos`}
              </span>
            </span>
            <Badge tone={PICKUP_LABEL[p.status][1]}>{PICKUP_LABEL[p.status][0]}</Badge>
          </li>
        ))}
        {pickups.length === 0 && <li className="p-6 text-center text-slate-500">Aún no hay recolecciones</li>}
      </ul>
    </div>
  );
}
