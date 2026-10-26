import type { Metadata } from "next";
import { prisma } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import { fecha, hace } from "@/lib/format";
import { ActionForm } from "@/components/action-form";
import { Badge, Card } from "@/components/ui";
import { discardAction, startRepairAction } from "./actions";
import { RepairClose } from "./repair-close";

export const metadata: Metadata = { title: "Fallas" };
const SEV = { baja: { label: "Leve", tone: "gray" as const }, media: { label: "Media", tone: "amber" as const }, alta: { label: "Grave", tone: "red" as const } };
const now = () => Date.now();

/** Fallas abiertas y en reparación [A24]. */
export default async function FallasPage() {
  await requireUser(["MECANICO", "ADMIN"]);
  const t = now();
  const [faults, employees] = await Promise.all([
    prisma.fault.findMany({
      where: { status: { in: ["ABIERTA", "EN_REPARACION"] } },
      include: { vehicle: { select: { code: true, plate: true } }, repair: true },
      orderBy: [{ status: "desc" }, { createdAt: "asc" }],
    }),
    prisma.employee.findMany({ where: { status: "ACTIVO" }, select: { id: true, name: true, employeeNo: true }, orderBy: { name: "asc" } }),
  ]);
  const names = new Map(employees.map((e) => [e.id, `${e.name} (U-${e.employeeNo})`]));
  const empOptions = employees.map((e) => ({ id: e.id, label: `${e.name} (U-${e.employeeNo})` }));
  const photo = (k: string) => `/api/fleet/photo/${k}`;

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <h1 className="text-xl font-bold">Fallas ({faults.length})</h1>
      {faults.length === 0 && <Card><p className="text-sm text-slate-500">Sin fallas pendientes.</p></Card>}
      {faults.map((f) => {
        const sev = SEV[f.severity as keyof typeof SEV] ?? SEV.media;
        const old = t - f.createdAt.getTime() > 24 * 3600_000 && f.status === "ABIERTA";
        return (
          <Card key={f.id} title={`${f.vehicle.code}${f.vehicle.plate ? ` · ${f.vehicle.plate}` : ""}`}
            actions={<div className="flex gap-1"><Badge tone={sev.tone}>{sev.label}</Badge><Badge tone={f.status === "ABIERTA" ? "red" : "blue"}>{f.status === "ABIERTA" ? "Abierta" : "En reparación"}</Badge></div>}>
            <p className="text-sm">{f.description}</p>
            <p className="mt-1 text-xs text-slate-500">
              {f.kind === "no_reportada" ? "No reportada en la mañana · " : ""}Reportó {names.get(f.reportedById) ?? "—"} · responsable {f.responsibleId ? names.get(f.responsibleId) : "sin definir"} ·{" "}
              <span className={old ? "font-semibold text-red-600" : ""}>hace {hace(f.createdAt, t)}</span>
            </p>
            {f.photos.length > 0 && (
              <div className="mt-2 flex gap-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {f.photos.map((k) => <a key={k} href={photo(k)} target="_blank" rel="noreferrer"><img src={photo(k)} alt="Foto de la falla" className="h-20 w-20 rounded-lg object-cover" /></a>)}
              </div>
            )}
            {f.status === "ABIERTA" ? (
              <div className="mt-3 flex flex-wrap items-start gap-3">
                <form action={startRepairAction.bind(null, f.id)}><button className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white">Empezar reparación</button></form>
                <details className="text-sm">
                  <summary className="cursor-pointer py-2 text-slate-600">Descartar</summary>
                  <ActionForm action={discardAction.bind(null, f.id)} submitLabel="Descartar falla"><input name="note" required placeholder="Motivo" className="w-64 rounded-lg border border-slate-300 px-3 py-2" /></ActionForm>
                </details>
              </div>
            ) : f.repair ? (
              <div className="mt-3 border-t border-slate-100 pt-3">
                <p className="mb-2 text-xs text-slate-500">En reparación desde {fecha(f.repair.startedAt)}</p>
                <RepairClose repairId={f.repair.id} employees={empOptions} responsibleId={f.responsibleId} />
              </div>
            ) : null}
          </Card>
        );
      })}
    </div>
  );
}
