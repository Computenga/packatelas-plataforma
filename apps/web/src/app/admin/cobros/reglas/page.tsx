import type { Metadata } from "next";
import Link from "next/link";
import { accountStates, getCreditRules, prisma, weeklyVolumes } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import { mxn } from "@/lib/format";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, PageHeader } from "@/components/ui";
import { CobrosTabs } from "../tabs";
import { ModeTable } from "./mode-table";
import { saveRulesAction } from "./actions";

export const metadata: Metadata = { title: "Crédito" };

const DAYS = ["", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

export default async function ReglasCreditoPage({ searchParams }: PageProps<"/admin/cobros/reglas">) {
  await requireUser(["ADMIN"]);
  const show = (await searchParams).ver === "todos" ? "todos" : "activos";
  const [rules, volumes, states, clients] = await Promise.all([
    getCreditRules(prisma),
    weeklyVolumes(prisma),
    accountStates(prisma),
    prisma.client.findMany({ where: { active: true }, select: { id: true, name: true, publicId: true, creditMode: true }, orderBy: { publicId: "asc" } }),
  ]);
  const rows = clients
    .map((c) => {
      const vol = volumes.get(c.id) ?? 0;
      const st = states.get(c.id)!;
      const suggestion: "califica" | "debajo" | null =
        c.creditMode === "PREPAID" && vol >= rules.minWeeklyShipments ? "califica" : c.creditMode === "WEEKLY_CREDIT" && vol < rules.minWeeklyShipments ? "debajo" : null;
      return { ...c, vol, balance: st.balance, overdue: st.overdue, blocked: st.blocked, exempt: st.exempt, suggestion };
    })
    .filter((r) => show === "todos" || r.vol > 0 || r.creditMode === "WEEKLY_CREDIT" || r.balance !== 0)
    .sort((a, b) => b.vol - a.vol);
  const qualify = rows.filter((r) => r.suggestion === "califica").length;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader eyebrow="Facturación" title="Cobros">Prepago y crédito semanal por cliente.</PageHeader>
      <CobrosTabs active="reglas" />

      <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
        <Card title="Reglas">
          <ActionForm action={saveRulesAction} submitLabel="Guardar reglas">
            <label className="block text-sm">
              <span className="text-slate-700">Envíos en 7 días para sugerir crédito</span>
              <input type="number" name="minWeeklyShipments" min={0} defaultValue={rules.minWeeklyShipments} className="mt-1 w-28 rounded-lg border border-slate-300 px-3 py-2" />
            </label>
            <label className="block text-sm">
              <span className="text-slate-700">Día de corte (amanece bloqueado si no liquidó)</span>
              <select name="cutWeekday" defaultValue={rules.cutWeekday} className="mt-1 block rounded-lg border border-slate-300 px-3 py-2">
                {DAYS.slice(1).map((d, i) => <option key={d} value={i + 1}>{d}</option>)}
              </select>
            </label>
          </ActionForm>
          <div className="mt-5 space-y-2 border-t border-slate-100 pt-4 text-xs text-slate-600">
            <p><strong>Prepago:</strong> si debe, la recolección se bloquea hasta que pague (o hasta bajar de su límite, si tiene uno).</p>
            <p><strong>Crédito semanal:</strong> acumula durante la semana; el {DAYS[rules.cutWeekday].toLowerCase()} a las 00:00 amanece bloqueado si no liquidó lo cargado antes del corte, y se libera al pagarlo. El límite en pesos de su ficha, si lo tiene, aplica como tope a media semana.</p>
            <p>Las exenciones con fecha siguen mandando sobre ambas.</p>
          </div>
        </Card>

        <Card
          title={`Clientes${qualify ? ` · ${qualify} califican a crédito` : ""}`}
          actions={
            <Link href={show === "todos" ? "/admin/cobros/reglas" : "/admin/cobros/reglas?ver=todos"} className="text-xs text-brand">
              {show === "todos" ? "Solo con movimiento" : "Ver todos"}
            </Link>
          }
        >
          <ModeTable
            rows={rows.map((r) => ({
              id: r.id,
              name: r.name,
              publicId: r.publicId,
              mode: r.creditMode,
              vol: r.vol,
              balance: mxn(r.balance),
              owes: r.balance > 0,
              overdue: r.overdue > 0 ? mxn(r.overdue) : null,
              status: r.blocked ? "Bloqueada" : r.exempt ? "Exenta" : "Habilitada",
              suggestion: r.suggestion,
            }))}
          />
          <p className="mt-3 text-xs text-slate-500">
            <Badge tone="blue">Califica</Badge> = en prepago con {rules.minWeeklyShipments}+ envíos en 7 días.{" "}
            <Badge tone="amber">Debajo</Badge> = en crédito con menos de {rules.minWeeklyShipments}. Solo es sugerencia: tú decides.
          </p>
        </Card>
      </div>
    </div>
  );
}
