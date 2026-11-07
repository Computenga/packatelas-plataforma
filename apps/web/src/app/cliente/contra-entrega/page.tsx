import type { Metadata } from "next";
import Link from "next/link";
import { clientCodSummary, prisma } from "@packatelas/db";
import { requireClient } from "@/lib/client-scope";
import { fecha, mxn } from "@/lib/format";
import { Card, PageHeader, Table, Td } from "@/components/ui";
import { Stat } from "@/components/stat";

export const metadata: Metadata = { title: "Cobros contra entrega" };
export const dynamic = "force-dynamic";

export default async function ClientCodPage() {
  const { clientId } = await requireClient();
  const s = await clientCodSummary(prisma, clientId);
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader eyebrow="Dinero" title="Cobros contra entrega">
        Lo que nuestros repartidores cobran a tus compradores te lo transferimos completo, sin comisión. Para que un envío sea por cobrar, marca «Cobrar a la entrega» al crearlo.
      </PageHeader>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat label="Cobrado, por transferirte" value={mxn(s.pendingTotal)} hint={`${s.pending.length} envío(s)`} />
        <Stat label="Por cobrar en ruta" value={mxn(s.inRouteTotal)} hint={`${s.inRouteCount} envío(s) sin entregar`} tone="amber" />
        <Stat label="Transferido" value={mxn(s.payouts.reduce((a, p) => a + Number(p.amount), 0))} hint="últimas 50 transferencias" tone="green" />
      </div>

      <Card title="Cobrado y pendiente de transferirte">
        <Table head={["Envío", "Destinatario", "Cobrado", "Cuándo"]} empty={s.pending.length ? undefined : "Nada pendiente"}>
          {s.pending.map((o) => (
            <tr key={o.id}>
              <Td><Link href={`/cliente/envio/${o.id}`} className="font-semibold hover:underline">{o.code}</Link></Td>
              <Td>{o.recipientName ?? "—"}</Td><Td className="font-semibold tabular-nums">{mxn(o.codCollected ?? 0)}</Td>
              <Td className="text-slate-500">{o.codCollectedAt ? fecha(o.codCollectedAt) : "—"}</Td>
            </tr>
          ))}
        </Table>
      </Card>

      <Card title="Transferencias que te hicimos">
        <div className="space-y-3 p-5">
          {s.payouts.length === 0 && <p className="text-sm text-slate-500">Aún no hay transferencias.</p>}
          {s.payouts.map((p) => (
            <details key={p.id} className="rounded-lg border border-slate-200">
              <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                <span><b>{fecha(p.paidAt)}</b> · ref. <span className="font-mono">{p.reference}</span></span>
                <span className="text-lg font-bold tabular-nums">{mxn(p.amount)} <span className="text-sm font-normal text-slate-500">· {p.orders.length} envío(s)</span></span>
              </summary>
              <ul className="divide-y divide-slate-100 border-t border-slate-100 text-sm">
                {p.orders.map((o) => (
                  <li key={o.id} className="flex justify-between px-4 py-2">
                    <span><Link href={`/cliente/envio/${o.id}`} className="font-semibold hover:underline">{o.code}</Link> · {o.recipientName ?? "—"}</span>
                    <span className="tabular-nums">{mxn(o.codCollected ?? 0)}</span>
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </div>
      </Card>
    </div>
  );
}
