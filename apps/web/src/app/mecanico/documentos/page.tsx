import type { Metadata } from "next";
import { DOC_TYPES, prisma } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import { ActionForm } from "@/components/action-form";
import { PhotoSlots } from "@/components/photo-slots";
import { Badge, Card } from "@/components/ui";
import { saveDocumentAction } from "../actions";

export const metadata: Metadata = { title: "Documentos" };
const todayMs = () => new Date(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date()) + "T00:00:00Z").getTime();

function Expiry({ d, t }: { d: Date | null; t: number }) {
  if (!d) return <span className="text-slate-400">—</span>;
  const days = Math.round((d.getTime() - t) / 86400_000);
  const tone = days < 0 ? "red" : days <= 7 ? "red" : days <= 30 ? "amber" : "green";
  return <Badge tone={tone}>{d.toISOString().slice(0, 10)}{days < 0 ? " · vencido" : days <= 30 ? ` · ${days} d` : ""}</Badge>;
}

/** Vigencias de documentos por moto, con evidencia [A24]. */
export default async function DocumentosPage() {
  await requireUser(["MECANICO", "ADMIN"]);
  const t = todayMs();
  const vehicles = await prisma.vehicle.findMany({ where: { status: { not: "BAJA" } }, include: { documents: true }, orderBy: { code: "asc" } });
  const types = Object.keys(DOC_TYPES).filter((k) => k !== "factura");
  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <h1 className="text-xl font-bold">Documentos</h1>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
            <tr><th className="px-3 py-2">Moto</th>{types.map((k) => <th key={k} className="px-3 py-2">{DOC_TYPES[k]}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {vehicles.map((v) => (
              <tr key={v.id}>
                <td className="px-3 py-2 font-medium">{v.code}<span className="block text-xs text-slate-500">{v.plate}</span></td>
                {types.map((k) => {
                  const d = v.documents.find((x) => x.type === k);
                  return (
                    <td key={k} className="px-3 py-2">
                      <Expiry d={d?.expiresAt ?? null} t={t} />
                      {d?.evidenceKey && <a href={`/api/fleet/photo/${d.evidenceKey}`} target="_blank" rel="noreferrer" className="ml-1 text-xs text-brand">ver</a>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Card title="Actualizar documento">
        <ActionForm action={saveDocumentAction} submitLabel="Guardar" resetOnSuccess>
          <div className="grid gap-3 sm:grid-cols-5">
            <select name="vehicleId" required defaultValue="" className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
              <option value="" disabled>Moto</option>
              {vehicles.map((v) => <option key={v.id} value={v.id}>{v.code}</option>)}
            </select>
            <select name="type" required className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
              {Object.entries(DOC_TYPES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            <input name="folio" placeholder="Folio" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            <label className="text-xs text-slate-500">Emisión<input type="date" name="issuedAt" className="block w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm" /></label>
            <label className="text-xs text-slate-500">Vigencia<input type="date" name="expiresAt" className="block w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm" /></label>
          </div>
          <div className="max-w-md"><PhotoSlots name="evidence" labels={["Evidencia"]} min={0} /></div>
        </ActionForm>
      </Card>
    </div>
  );
}
