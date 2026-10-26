import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@packatelas/db";
import { requireClient } from "@/lib/client-scope";
import { fecha, STATUS_LABEL, STATUS_TONE } from "@/lib/format";
import { Badge, Card } from "@/components/ui";
import { CopyLink } from "@/components/copy-link";
import { trackingPath } from "@/lib/tracking";

export const metadata: Metadata = { title: "Envío" };

const EVENT_LABEL: Record<string, string> = {
  created: "Registrado en Packatelas",
  assigned: "Asignado a repartidor",
  scanned_loaded: "En camino",
  delivered: "Entregado",
  failed: "Intento de entrega fallido",
  cancelled: "Cancelado",
  return_required: "Regresará al almacén de Packatelas",
  rescheduled: "Entrega reprogramada",
  return_received: "Recibido en el almacén de Packatelas",
  returned_to_seller: "Devuelto a tu tienda",
};

export default async function EnvioPage({ params, searchParams }: PageProps<"/cliente/envio/[id]">) {
  const { clientId } = await requireClient();
  const { id } = await params;
  const order = await prisma.order.findFirst({
    where: { id, clientId }, // nunca muestra pedidos de otro cliente
    include: {
      events: { where: { type: { in: Object.keys(EVENT_LABEL) } }, orderBy: { occurredAt: "desc" } },
      evidence: true,
    },
  });
  if (!order) notFound();
  const isNew = (await searchParams).nuevo === "1";
  const own = order.source !== "ML_FLEX" && order.source !== "ML_OTHER";

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="font-mono text-lg font-bold">{order.code}</h1>
        <Badge tone={STATUS_TONE[order.status]}>{STATUS_LABEL[order.status]}</Badge>
      </div>
      {isNew && (
        <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          Envío registrado. Imprime la etiqueta o escribe <span className="font-mono font-bold">{order.code}</span> en el paquete.
        </div>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <CopyLink path={trackingPath(order.id)} label="Enlace para tu comprador" text={`Sigue tu envío ${order.code}:`} />
        {own && <a href={`/etiqueta/${order.id}`} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium">Imprimir etiqueta</a>}
      </div>
      <Card title="Destino">
        <p className="text-sm">{order.recipientName ?? "—"}</p>
        <p className="text-sm text-slate-600">{[order.addressLine, order.neighborhood, order.city, order.zip].filter(Boolean).join(", ")}</p>
      </Card>
      <Card title="Seguimiento">
        <ol className="space-y-3">
          {order.events.map((e) => (
            <li key={e.id} className="text-sm">
              <p className="font-medium">{EVENT_LABEL[e.type]}</p>
              <p className="text-xs text-slate-500">{fecha(e.occurredAt)}</p>
              {["failed", "rescheduled", "return_required"].includes(e.type) && e.note && <p className="text-xs text-slate-600">{e.note}</p>}
            </li>
          ))}
        </ol>
      </Card>
      {order.evidence.length > 0 && (
        <Card title="Evidencia de entrega">
          <div className="grid grid-cols-2 gap-2">
            {order.evidence.map((ev) => (
              <a key={ev.id} href={`/api/evidence/${ev.storageKey}`} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/evidence/${ev.storageKey}`} alt="Evidencia de entrega" className="aspect-square w-full rounded-lg object-cover" />
                {ev.receiverName && <span className="mt-1 block text-xs text-slate-600">Recibió: {ev.receiverName}</span>}
              </a>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
