import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FAIL_REASONS, INSURANCE_REASONS, prisma } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import { STAFF_ROLES } from "@/lib/roles";
import { fecha, mxn, STATUS_LABEL, STATUS_TONE } from "@/lib/format";
import { Badge, Button, Card, PageHeader } from "@/components/ui";
import { cancelOrder, insuranceAction, manualCloseAction, rescheduleAction, sendToWarehouseAction } from "../actions";
import { ActionForm } from "@/components/action-form";
import { trackingPath } from "@/lib/tracking";
import { MlSaleCard } from "@/components/ml-sale";

export const metadata: Metadata = { title: "Pedido" };

const SOURCE_LABEL: Record<string, string> = {
  SCAN: "Escaneo", DRIVER_APP: "App repartidor", ADMIN: "Administración", CLIENT: "Cliente",
  ML_SYNC: "MercadoLibre", FLEX_HANDSHAKE: "Flex", IMPORT: "Importación", SYSTEM: "Sistema",
};
const EVENT_LABEL: Record<string, string> = {
  created: "Pedido registrado", scanned: "Escaneado de nuevo", assigned: "Asignado", delivered: "Entregado",
  failed: "Entrega fallida", cancelled: "Cancelado", scanned_loaded: "Cargado por repartidor",
  unassigned: "Regresado a por asignar", return_required: "Llevar a bodega", rescheduled: "Reprogramado",
  return_received: "Recibido en bodega", returned_to_seller: "Devuelto al vendedor",
  flex_assigned: "Tomado en Flex", ml_status: "MercadoLibre", insurance: "Seguro aplicado", reassigned: "Reasignado",
};

const CAN_SEND_BACK = ["FAILED", "RESCHEDULED", "ASSIGNED", "OUT_FOR_DELIVERY"];
const CAN_RESCHEDULE = ["FAILED", "RETURNING", "RETURNED_TO_WAREHOUSE", "RESCHEDULED"];

export default async function PedidoPage({ params }: PageProps<"/admin/pedidos/[id]">) {
  const user = await requireUser(STAFF_ROLES);
  const { id } = await params;
  const order = await prisma.order.findUnique({
    where: { id },
    include: {
      client: true,
      branch: true,
      mlAccount: { select: { nickname: true } },
      driver: { include: { user: { select: { name: true } } } },
      events: { orderBy: { occurredAt: "desc" }, include: { actor: { select: { name: true } } } },
      ledger: true,
      evidence: true,
      returnOrder: { select: { id: true, code: true, status: true } },
      returnItems: { select: { id: true, code: true, status: true }, orderBy: { code: "asc" } },
    },
  });
  if (!order) notFound();
  const charge = order.ledger.find((l) => l.type === "CHARGE");
  const insurance = order.ledger.find((l) => l.type === "INSURANCE");
  const suggested = order.declaredValue ?? order.mlSaleTotal;
  const canAct = ["ADMIN", "OPERADOR", "DESPACHADOR"].includes(user.role);
  const canSendBack = canAct && CAN_SEND_BACK.includes(order.status);
  const canReschedule = canAct && CAN_RESCHEDULE.includes(order.status);
  const canCancel = user.role === "ADMIN" && !["DELIVERED", "CANCELLED", "RETURNED_TO_SELLER"].includes(order.status);

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        eyebrow="Pedido"
        title={order.code}
        actions={
          <>
            <a href={trackingPath(order.id)} target="_blank" rel="noreferrer" className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm">Seguimiento</a>
            {order.mlShipmentId ? (
              <a href={`/guia/${order.mlShipmentId}`} target="_blank" rel="noopener" className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm">Reimprimir guía</a>
            ) : (
              <a href={`/etiqueta/${order.id}`} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm">Etiqueta</a>
            )}
            <Badge tone={STATUS_TONE[order.status]}>{STATUS_LABEL[order.status]}</Badge>
          </>
        }
      >
        <Link href={`/admin/clientes/${order.clientId}`} className="text-brand hover:underline">{order.client.name}</Link>
        {order.branch && ` · ${order.branch.name}`}
        {order.mlAccount && ` · ML ${order.mlAccount.nickname}`}
      </PageHeader>

      <div className="grid gap-6 md:grid-cols-[1fr_340px]">
        <Card title="Historial">
          <ol className="relative space-y-4 border-l border-slate-200 pl-5">
            {order.events.map((e) => (
              <li key={e.id}>
                <span className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full border-2 border-white bg-brand" />
                <p className="text-sm font-medium">
                  {EVENT_LABEL[e.type] ?? e.type}
                  {e.toStatus && e.fromStatus && e.toStatus !== e.fromStatus && (
                    <span className="font-normal text-slate-500"> · {STATUS_LABEL[e.fromStatus]} → {STATUS_LABEL[e.toStatus]}</span>
                  )}
                </p>
                <p className="text-xs text-slate-500">
                  {fecha(e.occurredAt)} · {SOURCE_LABEL[e.source] ?? e.source}
                  {e.actor && ` · ${e.actor.name}`}
                  {e.lat != null && e.lng != null && (
                    <>
                      {" · "}
                      <a className="text-brand hover:underline" target="_blank" rel="noreferrer" href={`https://maps.google.com/?q=${e.lat},${e.lng}`}>
                        ver ubicación
                      </a>
                    </>
                  )}
                </p>
                {e.note && <p className="mt-1 text-sm text-slate-700">{e.note}</p>}
              </li>
            ))}
          </ol>
        </Card>

        <div className="space-y-6">
          <Card title="Entrega">
            <dl className="space-y-2 text-sm">
              <Row label="Destinatario" value={order.recipientName} />
              <Row label="Teléfono" value={order.recipientPhone} />
              <Row label="Dirección" value={[order.addressLine, order.neighborhood, order.city, order.state, order.zip].filter(Boolean).join(", ")} />
              {order.lat != null && (
                <Row
                  label="Mapa"
                  value={<a className="text-brand hover:underline" target="_blank" rel="noreferrer" href={`https://maps.google.com/?q=${order.lat},${order.lng}`}>Abrir en Google Maps</a>}
                />
              )}
              <Row label="Instrucciones" value={order.instructions} />
              <Row label="Contenido" value={order.itemsSummary} />
              {order.codAmount != null && (
                <Row label="Por cobrar" value={<b>{mxn(order.codAmount)} · {order.codCollectedAt ? `cobrado ${mxn(order.codCollected ?? order.codAmount)} (${fecha(order.codCollectedAt)}) · ${order.codPayoutId ? "transferido a la tienda" : order.codHandedAt ? "efectivo en oficina" : "efectivo con el repartidor"}` : "pendiente"}</b>} />
              )}
              <Row label="Repartidor" value={order.driver?.user.name} />
              <Row label="Intentos" value={String(order.attempts)} />
              <Row label="Entregado" value={order.deliveredAt ? fecha(order.deliveredAt) : null} />
            </dl>
          </Card>
          {order.kind === "RETURN" && (
            <Card title={`Paquetes de esta devolución (${order.returnItems.length})`}>
              <ul className="divide-y divide-slate-100 text-sm">
                {order.returnItems.map((r) => (
                  <li key={r.id} className="flex justify-between py-1.5">
                    <Link href={`/admin/pedidos/${r.id}`} className="font-mono text-brand hover:underline">{r.code}</Link>
                    <span className="text-xs text-slate-500">{STATUS_LABEL[r.status]}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-slate-500">Al marcar esta orden como entregada, todos quedan «Devuelto al vendedor». Se asigna en Despacho como cualquier pedido; no genera cargo a la tienda.</p>
            </Card>
          )}
          {order.returnOrder && (
            <Card title="Devolución a la tienda">
              <p className="text-sm">Va en la orden <Link href={`/admin/pedidos/${order.returnOrder.id}`} className="font-mono font-semibold text-brand hover:underline">{order.returnOrder.code}</Link> · {STATUS_LABEL[order.returnOrder.status]}</p>
            </Card>
          )}
          <MlSaleCard order={order} />
          {order.evidence.length > 0 && (
            <Card title="Evidencia">
              <div className="grid grid-cols-2 gap-2">
                {order.evidence.map((ev) => (
                  <a key={ev.id} href={`/api/evidence/${ev.storageKey}`} target="_blank" rel="noreferrer" className="block">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/evidence/${ev.storageKey}`} alt="Evidencia de entrega" className="aspect-square w-full rounded-lg object-cover" />
                    {ev.receiverName && <span className="mt-1 block text-xs text-slate-600">Recibió: {ev.receiverName}</span>}
                  </a>
                ))}
              </div>
            </Card>
          )}
          <Card title="Cobro">
            <p className="text-sm">{charge ? `Cargo de ${mxn(charge.amount)} el ${fecha(charge.createdAt)}` : "Sin cargo"}</p>
            {order.mlShipmentId && (
              <p className="mt-2 text-xs text-slate-500">Envío ML {order.mlShipmentId.toString()} · {order.mlStatus ?? "sin sincronizar"}</p>
            )}
          </Card>
          {canAct && ["CREATED", "ASSIGNED", "OUT_FOR_DELIVERY", "FAILED", "RESCHEDULED"].includes(order.status) && (
            <Card title={order.kind === "PICKUP" ? "Cerrar recolección a mano" : "Cerrar a mano"}>
              <ActionForm action={manualCloseAction.bind(null, order.id)} submitLabel="Guardar">
                <p className="text-xs text-slate-500">Si el repartidor no pudo cerrarlo en la app. Queda en el historial con tu nombre y el motivo.</p>
                <select name="outcome" className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
                  <option value="delivered">{order.kind === "PICKUP" ? "Recolectada" : "Entregado"}</option>
                  <option value="failed">{order.kind === "PICKUP" ? "No se pudo recolectar" : "No entregado"}</option>
                </select>
                {order.kind !== "PICKUP" && (
                  <>
                    <input name="receiverName" placeholder="Quién recibió (si se entregó)" maxLength={120} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                    <select name="reason" defaultValue="otro" className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" aria-label="Motivo si no se entregó">
                      {Object.entries(FAIL_REASONS).map(([k, v]) => <option key={k} value={k}>Si no se entregó: {v}</option>)}
                    </select>
                  </>
                )}
                <input name="note" required minLength={3} maxLength={200} placeholder="Motivo del cierre a mano" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              </ActionForm>
            </Card>
          )}
          {(canSendBack || canReschedule) && (
            <Card title="Siguiente paso">
              {order.status === "RETURNING" && (
                <p className="mb-3 text-sm text-amber-800">
                  {order.driver ? `${order.driver.user.name} debe dejarlo en bodega.` : "Pendiente de llegar a bodega."} Al llegar, escanéalo en Devoluciones → Recibir.
                </p>
              )}
              {canReschedule && (
                <ActionForm action={rescheduleAction.bind(null, order.id)} submitLabel="Reprogramar entrega" className="mb-4">
                  <label className="block text-sm">
                    <span className="text-slate-600">Fecha (opcional)</span>
                    <input type="date" name="date" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
                  </label>
                  <input name="note" placeholder="Nota (p. ej. cliente pidió por la tarde)" maxLength={200} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                </ActionForm>
              )}
              {canSendBack && (
                <ActionForm action={sendToWarehouseAction.bind(null, order.id)} submitLabel="Regresar a bodega">
                  <p className="text-xs text-slate-500">El repartidor que lo trae lo verá en su lista de &quot;Llevar a bodega&quot;.</p>
                </ActionForm>
              )}
            </Card>
          )}
          {insurance ? (
            <Card title="Seguro">
              <p className="text-sm">
                <span className="font-semibold text-emerald-700">{mxn(insurance.amount.abs())}</span> abonados el {fecha(insurance.createdAt)}
              </p>
              <p className="mt-1 text-xs text-slate-500">{insurance.description}</p>
            </Card>
          ) : (
            user.role === "ADMIN" && (
              <Card title="Aplicar seguro">
                <ActionForm action={insuranceAction.bind(null, order.id)} submitLabel="Aplicar seguro">
                  <p className="text-xs text-slate-500">Por pérdida o daño: el monto se abona al saldo de {order.client.name} y le llega un aviso. Solo una vez por envío.</p>
                  <label className="block text-sm">
                    <span className="text-slate-600">Monto a reembolsar</span>
                    <input name="amount" inputMode="decimal" required placeholder="0.00" defaultValue={suggested ? Number(suggested).toFixed(2) : ""} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
                    {suggested && <span className="mt-1 block text-xs text-slate-500">Sugerido: {order.declaredValue ? "valor declarado" : "total de la venta en ML"}</span>}
                  </label>
                  <label className="block text-sm">
                    <span className="text-slate-600">Motivo</span>
                    <select name="reason" required className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2">
                      {INSURANCE_REASONS.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
                    </select>
                  </label>
                  <textarea name="note" required minLength={5} maxLength={200} rows={2} placeholder="Qué pasó (p. ej. paquete extraviado en ruta del 2 de nov.)" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                </ActionForm>
              </Card>
            )
          )}
          {canCancel && (
            <form action={cancelOrder.bind(null, order.id)}>
              <Button variant="danger" className="w-full">Cancelar pedido</Button>
              <p className="mt-1 text-xs text-slate-500">El cargo no se borra; si aplica, registra un ajuste en Cobros.</p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_1fr] gap-2">
      <dt className="text-slate-500">{label}</dt>
      <dd>{value || "—"}</dd>
    </div>
  );
}
