import type { Metadata } from "next";
import Link from "next/link";
import { accountStates, prisma } from "@packatelas/db";
import { CobrosTabs } from "./tabs";
import { requireUser } from "@/lib/auth";
import { fecha, mxn } from "@/lib/format";
import { Badge, PageHeader, Table, Td } from "@/components/ui";
import { Stat } from "@/components/stat";
import { applyPaymentAction, dismissPaymentAction } from "./actions";

export const metadata: Metadata = { title: "Cobros" };

export default async function CobrosPage() {
  await requireUser(["ADMIN"]);
  const [byClient, totals, clients, recent, unidentified, states] = await Promise.all([
    prisma.ledgerEntry.groupBy({ by: ["clientId"], _sum: { amount: true } }),
    prisma.ledgerEntry.groupBy({ by: ["type"], _sum: { amount: true } }),
    prisma.client.findMany({ select: { id: true, name: true, publicId: true, creditLimit: true, pickupExemptUntil: true } }),
    prisma.payment.findMany({ orderBy: { receivedAt: "desc" }, take: 15, include: { client: { select: { name: true } } } }),
    prisma.payment.findMany({ where: { status: "UNIDENTIFIED" }, orderBy: { receivedAt: "asc" }, take: 100 }),
    accountStates(prisma),
  ]);
  const balance = new Map(byClient.map((b) => [b.clientId, Number(b._sum.amount ?? 0)]));
  const sum = (t: string) => Number(totals.find((x) => x.type === t)?._sum.amount ?? 0);
  const owed = [...balance.values()].filter((v) => v > 0).reduce((a, b) => a + b, 0);
  const rows = clients
    .map((c) => ({ ...c, bal: balance.get(c.id) ?? 0 }))
    .filter((c) => c.bal !== 0)
    .sort((a, b) => b.bal - a.bal);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader eyebrow="Facturación" title="Cobros">Saldos por cliente, abonos y ajustes. Saldo positivo = el cliente debe.</PageHeader>
      <CobrosTabs active="saldos" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Cargos" value={mxn(sum("CHARGE") + sum("FEE"))} />
        <Stat label="Abonos" value={mxn(-sum("PAYMENT"))} tone="green" />
        <Stat label="Ajustes" value={mxn(sum("ADJUSTMENT"))} tone="amber" />
        <Stat label="Por cobrar" value={mxn(owed)} tone="red" />
      </div>

      <Table head={["Cliente", "ID", "Saldo", "Forma de pago", "Recolección"]} empty={rows.length ? undefined : "Sin saldos"}>
        {rows.map((c) => {
          const st = states.get(c.id);
          const exempt = st?.exempt;
          const blocked = st?.blocked;
          return (
            <tr key={c.id} className="hover:bg-slate-50">
              <Td><Link href={`/admin/cobros/${c.id}`} className="font-medium text-brand hover:underline">{c.name}</Link></Td>
              <Td className="font-mono text-xs">{c.publicId}</Td>
              <Td className={c.bal > 0 ? "font-semibold text-red-600" : "text-emerald-700"}>{c.bal > 0 ? mxn(c.bal) : `${mxn(-c.bal)} a favor`}</Td>
              <Td className="text-xs">
                {st?.mode === "WEEKLY_CREDIT" ? "Crédito semanal" : "Prepago"}
                {st?.mode === "WEEKLY_CREDIT" && st.overdue > 0 && <span className="block text-red-600">vencido {mxn(st.overdue)}</span>}
              </Td>
              <Td>{blocked ? <span title={st?.reason ?? ""}><Badge tone="red">Bloqueada</Badge></span> : exempt ? <Badge tone="blue">Exenta</Badge> : <Badge tone="green">Habilitada</Badge>}</Td>
            </tr>
          );
        })}
      </Table>

      {unidentified.length > 0 && (
        <section>
          <h2 className="mb-2 font-semibold text-amber-800">Pagos sin identificar ({unidentified.length})</h2>
          <Table head={["Fecha", "Monto", "Ordenante", "Concepto", "Aplicar a", ""]}>
            {unidentified.map((p) => (
              <tr key={p.id}>
                <Td>{fecha(p.receivedAt)}</Td>
                <Td className="font-semibold">{mxn(p.amount)}</Td>
                <Td>{p.senderName ?? "—"}</Td>
                <Td className="whitespace-normal">
                  <span className="font-mono text-xs">{p.reference ?? "—"}</span>
                  {p.note && <span className="block text-xs text-amber-700">{p.note.split(" (concepto")[0]}</span>}
                </Td>
                <Td>
                  <form action={applyPaymentAction.bind(null, p.id)} className="flex gap-2">
                    <select name="clientId" required defaultValue="" className="rounded-lg border border-slate-300 px-2 py-1 text-sm" aria-label="Cliente">
                      <option value="" disabled>Elige cliente</option>
                      {[...clients].sort((a, b) => a.name.localeCompare(b.name)).map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                    <button className="rounded-lg bg-brand px-3 py-1 text-sm text-white">Aplicar</button>
                  </form>
                </Td>
                <Td>
                  <form action={dismissPaymentAction.bind(null, p.id)}>
                    <button className="text-xs text-slate-500 hover:text-red-600" title="Traspasos propios, Mercado Pago, etc.">No es de cliente</button>
                  </form>
                </Td>
              </tr>
            ))}
          </Table>
        </section>
      )}

      <section>
        <h2 className="mb-2 font-semibold">Últimos pagos</h2>
        <Table head={["Fecha", "Cliente", "Monto", "Origen", "Referencia"]} empty={recent.length ? undefined : "Sin pagos"}>
          {recent.map((p) => (
            <tr key={p.id}>
              <Td>{fecha(p.receivedAt)}</Td>
              <Td>{p.client?.name ?? <Badge tone="amber">Sin identificar</Badge>}</Td>
              <Td>{mxn(p.amount)}</Td>
              <Td>{p.source === "MANUAL" ? "Manual" : p.source === "GMAIL" ? (p.status === "APPLIED" ? "Transferencia · automático" : p.status === "REJECTED" ? "No es de cliente" : "Transferencia") : "Mercado Pago"}</Td>
              <Td className="font-mono text-xs">{p.reference ?? "—"}</Td>
            </tr>
          ))}
        </Table>
      </section>
    </div>
  );
}
