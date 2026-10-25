import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import { STAFF_ROLES } from "@/lib/roles";
import { fecha, mxn, STATUS_LABEL, STATUS_TONE } from "@/lib/format";
import { Badge, Button, Card, PageHeader } from "@/components/ui";
import { cancelOrder } from "../actions";

export const metadata: Metadata = { title: "Pedido" };

const SOURCE_LABEL: Record<string, string> = {
  SCAN: "Escaneo", DRIVER_APP: "App repartidor", ADMIN: "Administración", CLIENT: "Cliente",
  ML_SYNC: "MercadoLibre", FLEX_HANDSHAKE: "Flex", IMPORT: "Importación", SYSTEM: "Sistema",
};
const EVENT_LABEL: Record<string, string> = {
  created: "Pedido registrado", scanned: "Escaneado de nuevo", assigned: "Asignado", delivered: "Entregado",
  failed: "Entrega fallida", cancelled: "Cancelado", scanned_loaded: "Cargado por repartidor",
};

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
    },
  });
  if (!order) notFound();
  const charge = order.ledger.find((l) => l.type === "CHARGE");
  const canCancel = user.role === "ADMIN" && !["DELIVERED", "CANCELLED", "RETURNED_TO_SELLER"].includes(order.status);

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        eyebrow="Pedido"
        title={order.code}
        actions={<Badge tone={STATUS_TONE[order.status]}>{STATUS_LABEL[order.status]}</Badge>}
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
              <Row label="Repartidor" value={order.driver?.user.name} />
              <Row label="Intentos" value={String(order.attempts)} />
              <Row label="Entregado" value={order.deliveredAt ? fecha(order.deliveredAt) : null} />
            </dl>
          </Card>
          <Card title="Cobro">
            <p className="text-sm">{charge ? `Cargo de ${mxn(charge.amount)} el ${fecha(charge.createdAt)}` : "Sin cargo"}</p>
            {order.mlShipmentId && (
              <p className="mt-2 text-xs text-slate-500">Envío ML {order.mlShipmentId.toString()} · {order.mlStatus ?? "sin sincronizar"}</p>
            )}
          </Card>
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
