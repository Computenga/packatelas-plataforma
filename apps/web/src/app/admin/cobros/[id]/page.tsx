import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { accountState, getClientBalance, prisma } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import { fecha, mxn } from "@/lib/format";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, Field, PageHeader, Select, Table, Td } from "@/components/ui";
import { adjustmentAction, exemptionAction, paymentAction } from "../actions";

export const metadata: Metadata = { title: "Estado de cuenta" };

const TYPE_LABEL = { CHARGE: "Cargo", PAYMENT: "Abono", FEE: "Comisión", ADJUSTMENT: "Ajuste" } as const;

export default async function EstadoCuentaPage({ params, searchParams }: PageProps<"/admin/cobros/[id]">) {
  await requireUser(["ADMIN"]);
  const { id } = await params;
  const page = Math.max(1, Number((await searchParams).page) || 1);
  const client = await prisma.client.findUnique({ where: { id } });
  if (!client) notFound();

  const [balance, state, entries, count] = await Promise.all([
    getClientBalance(prisma, id),
    accountState(prisma, id),
    prisma.ledgerEntry.findMany({ where: { clientId: id }, orderBy: { createdAt: "desc" }, skip: (page - 1) * 100, take: 100, include: { order: { select: { id: true, code: true } } } }),
    prisma.ledgerEntry.count({ where: { clientId: id } }),
  ]);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date());
  const { blocked, exempt } = state;

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        eyebrow={`Estado de cuenta · ${client.publicId}`}
        title={client.name}
        actions={blocked ? <span title={state.reason ?? ""}><Badge tone="red">Recolección bloqueada</Badge></span> : exempt ? <Badge tone="blue">Exento</Badge> : <Badge tone="green">Recolección habilitada</Badge>}
      >
        Saldo <strong className={balance.gt(0) ? "text-red-600" : "text-emerald-700"}>{balance.gt(0) ? mxn(balance) : `${mxn(balance.abs())} a favor`}</strong>
        {" · "}{client.creditMode === "WEEKLY_CREDIT" ? "Crédito semanal" : "Prepago"}
        {state.overdue > 0 && client.creditMode === "WEEKLY_CREDIT" && <> · <span className="text-red-600">vencido {mxn(state.overdue)}</span></>}
        {" · "}Límite {client.creditLimit ? mxn(client.creditLimit) : "—"} · Referencia <span className="font-mono">{client.paymentReference}</span>
        {" · "}<Link href={`/admin/clientes/${id}`} className="text-brand hover:underline">Ficha del cliente</Link>
      </PageHeader>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div>
          <Table head={["Fecha", "Movimiento", "Detalle", "Monto"]} empty={entries.length ? undefined : "Sin movimientos"}>
            {entries.map((e) => (
              <tr key={e.id}>
                <Td className="text-slate-600">{fecha(e.createdAt)}</Td>
                <Td><Badge tone={e.type === "PAYMENT" ? "green" : e.type === "ADJUSTMENT" ? "amber" : "gray"}>{TYPE_LABEL[e.type]}</Badge></Td>
                <Td className="whitespace-normal">
                  {e.order ? <Link href={`/admin/pedidos/${e.order.id}`} className="font-mono text-xs text-brand hover:underline">{e.order.code}</Link> : e.description}
                </Td>
                <Td className={`text-right tabular-nums ${Number(e.amount) < 0 ? "text-emerald-700" : ""}`}>{mxn(e.amount)}</Td>
              </tr>
            ))}
          </Table>
          {count > 100 && (
            <div className="mt-3 flex justify-between text-sm">
              <span className="text-slate-500">Página {page} de {Math.ceil(count / 100)}</span>
              <span className="flex gap-3">
                {page > 1 && <Link className="text-brand" href={`?page=${page - 1}`}>Más recientes</Link>}
                {page * 100 < count && <Link className="text-brand" href={`?page=${page + 1}`}>Anteriores</Link>}
              </span>
            </div>
          )}
        </div>

        <div className="space-y-6">
          <Card title="Registrar abono">
            <ActionForm action={paymentAction.bind(null, id)} submitLabel="Registrar abono" resetOnSuccess>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Monto (MXN)" name="amount" type="number" step="0.01" min="0.01" required />
                <Field label="Fecha" name="date" type="date" defaultValue={today} max={today} required />
              </div>
              <Select label="Forma de pago" name="method" defaultValue="TRANSFER">
                <option value="TRANSFER">Transferencia</option>
                <option value="CASH">Efectivo</option>
                <option value="OTHER">Otro</option>
              </Select>
              <Field label="Referencia / clave de rastreo" name="reference" />
              <Field label="Nota" name="note" />
            </ActionForm>
          </Card>

          <Card title="Ajuste de saldo">
            <ActionForm action={adjustmentAction.bind(null, id)} submitLabel="Registrar ajuste" resetOnSuccess>
              <div className="grid grid-cols-2 gap-3">
                <Select label="Tipo" name="kind" defaultValue="credit">
                  <option value="credit">Bonificación (resta)</option>
                  <option value="charge">Cargo extra (suma)</option>
                </Select>
                <Field label="Monto" name="amount" type="number" step="0.01" min="0.01" required />
              </div>
              <Field label="Motivo" name="description" required />
            </ActionForm>
          </Card>

          <Card title="Exención de bloqueo">
            {exempt && <p className="mb-3 text-sm text-blue-700">Exento hasta {fecha(client.pickupExemptUntil)}{client.pickupExemptNote && ` · ${client.pickupExemptNote}`}</p>}
            <ActionForm action={exemptionAction.bind(null, id)} submitLabel="Guardar exención">
              <Field label="Permitir recolecciones hasta" name="until" type="date" min={today} />
              <Field label="Motivo" name="note" placeholder="p. ej. acuerdo de pago" />
            </ActionForm>
            {exempt && (
              <ActionForm action={exemptionAction.bind(null, id)} submitLabel="Retirar exención" className="mt-3">
                <input type="hidden" name="remove" value="1" />
              </ActionForm>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
