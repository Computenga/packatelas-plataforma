import type { Metadata } from "next";
import Link from "next/link";
import { codCashByDriver, codPendingByClient, prisma, todayMx } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import { fecha, mxn } from "@/lib/format";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, Field, PageHeader, Table, Td } from "@/components/ui";
import { Stat } from "@/components/stat";
import { CobrosTabs } from "../tabs";
import { payoutAction, receiveCashAction } from "./actions";

export const metadata: Metadata = { title: "Cobros contra entrega" };
export const dynamic = "force-dynamic";

export default async function CodPage() {
  await requireUser(["ADMIN"]);
  const [drivers, clients, payouts] = await Promise.all([
    codCashByDriver(prisma),
    codPendingByClient(prisma),
    prisma.codPayout.findMany({ orderBy: { paidAt: "desc" }, take: 30, include: { client: { select: { name: true } }, _count: { select: { orders: true } } } }),
  ]);
  const inStreet = drivers.reduce((s, d) => s + d.total, 0);
  const toPay = clients.reduce((s, c) => s + c.total, 0);
  const today = todayMx();

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader eyebrow="Facturación" title="Cobros contra entrega">
        El repartidor cobra en efectivo al entregar, lo entrega en oficina y se le transfiere a la tienda completo (sin comisión). No afecta el saldo de envíos de la tienda.
      </PageHeader>
      <CobrosTabs active="contra_entrega" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat label="Efectivo con repartidores" value={mxn(inStreet)} tone="amber" hint="Cobrado y sin entregar en oficina" />
        <Stat label="Por transferir a tiendas" value={mxn(toPay)} hint={`${clients.length} tienda(s)`} />
        <Stat label="Transferido (últimas 30)" value={mxn(payouts.reduce((s, p) => s + Number(p.amount), 0))} tone="green" />
      </div>

      <Card title="1. Corte de efectivo por repartidor">
        <div className="space-y-4 p-5">
          {drivers.length === 0 && <p className="text-sm text-slate-500">Ningún repartidor trae efectivo pendiente de entregar.</p>}
          {drivers.map((d) => (
            <details key={d.driverId ?? "-"} className="rounded-lg border border-slate-200">
              <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 px-4 py-3">
                <span className="font-semibold">{d.name}</span>
                <span className="text-lg font-bold tabular-nums">{mxn(d.total)} <span className="text-sm font-normal text-slate-500">· {d.orders.length} entrega(s)</span></span>
              </summary>
              <div className="border-t border-slate-100 p-4">
                <Table head={["Pedido", "Tienda", "Destinatario", "Cobrado", "Cuándo"]}>
                  {d.orders.map((o) => (
                    <tr key={o.id}>
                      <Td><Link href={`/admin/pedidos/${o.id}`} className="text-brand hover:underline">{o.code}</Link></Td>
                      <Td>{o.client.name}</Td><Td>{o.recipientName ?? "—"}</Td>
                      <Td className="font-semibold tabular-nums">{mxn(o.codCollected ?? 0)}</Td><Td className="text-slate-500">{o.codCollectedAt ? fecha(o.codCollectedAt) : "—"}</Td>
                    </tr>
                  ))}
                </Table>
                {d.driverId && (
                  <ActionForm action={receiveCashAction.bind(null, d.driverId)} submitLabel={`Recibí ${mxn(d.total)} en efectivo`} className="mt-3 max-w-sm">
                    <p className="text-sm text-slate-600">Cuenta el efectivo antes de confirmar: queda registrado quién lo recibió y a qué hora.</p>
                  </ActionForm>
                )}
              </div>
            </details>
          ))}
        </div>
      </Card>

      <Card title="2. Por transferir a cada tienda">
        <div className="space-y-4 p-5">
          {clients.length === 0 && <p className="text-sm text-slate-500">No hay cobros pendientes de transferir.</p>}
          {clients.map((c) => (
            <details key={c.clientId} className="rounded-lg border border-slate-200">
              <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 px-4 py-3">
                <span className="font-semibold">{c.name}</span>
                <span className="text-lg font-bold tabular-nums">
                  {mxn(c.total)} <span className="text-sm font-normal text-slate-500">· {c.orders.length} envío(s)</span>
                  {c.inOffice < c.total && <span className="ml-2 align-middle"><Badge tone="amber">{mxn(c.total - c.inOffice)} aún con repartidor</Badge></span>}
                </span>
              </summary>
              <ActionForm action={payoutAction.bind(null, c.clientId)} submitLabel="Registrar transferencia" className="border-t border-slate-100 p-4">
                <Table head={["", "Pedido", "Destinatario", "Cobrado", "Cuándo", "Efectivo"]}>
                  {c.orders.map((o) => (
                    <tr key={o.id}>
                      <Td><input type="checkbox" name="orderId" value={o.id} defaultChecked aria-label={`Incluir ${o.code}`} className="h-4 w-4 accent-brand" /></Td>
                      <Td><Link href={`/admin/pedidos/${o.id}`} className="text-brand hover:underline">{o.code}</Link></Td>
                      <Td>{o.recipientName ?? "—"}</Td>
                      <Td className="font-semibold tabular-nums">{mxn(o.codCollected ?? 0)}</Td>
                      <Td className="text-slate-500">{o.codCollectedAt ? fecha(o.codCollectedAt) : "—"}</Td>
                      <Td>{o.codHandedAt ? <Badge tone="green">En oficina</Badge> : <Badge tone="amber">Con repartidor</Badge>}</Td>
                    </tr>
                  ))}
                </Table>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="Referencia / clave de rastreo" name="reference" required />
                  <Field label="Fecha de la transferencia" name="date" type="date" defaultValue={today} required />
                  <Field label="Nota (opcional)" name="note" />
                </div>
                <p className="text-xs text-slate-500">Se transfiere el total de los pedidos palomeados. La tienda recibe un aviso y ve el detalle en su portal.</p>
              </ActionForm>
            </details>
          ))}
        </div>
      </Card>

      <Card title="3. Transferencias registradas">
        <Table head={["Fecha", "Tienda", "Importe", "Envíos", "Referencia", "Nota"]} empty={payouts.length ? undefined : "Aún no hay transferencias"}>
          {payouts.map((p) => (
            <tr key={p.id}>
              <Td>{fecha(p.paidAt)}</Td><Td>{p.client.name}</Td><Td className="font-semibold tabular-nums">{mxn(p.amount)}</Td>
              <Td>{p._count.orders}</Td><Td className="font-mono text-xs">{p.reference}</Td><Td className="text-slate-500">{p.note ?? ""}</Td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}
