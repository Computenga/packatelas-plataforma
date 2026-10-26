import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@packatelas/db";
import { requireClient } from "@/lib/client-scope";
import { fecha, STATUS_LABEL, STATUS_TONE } from "@/lib/format";
import { Badge, Card } from "@/components/ui";

export const metadata: Metadata = { title: "Envío" };

const EVENT_LABEL: Record<string, string> = {
  created: "Registrado en Packatelas",
  assigned: "Asignado a repartidor",
  scanned_loaded: "En camino",
  delivered: "Entregado",
  failed: "Intento de entrega fallido",
  cancelled: "Cancelado",
  return_received: "Devuelto al almacén de Packatelas",
  return_delivered: "Devuelto a tu sucursal",
};

export default async function EnvioPage({ params }: PageProps<"/cliente/envio/[id]">) {
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

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="font-mono text-lg font-bold">{order.code}</h1>
        <Badge tone={STATUS_TONE[order.status]}>{STATUS_LABEL[order.status]}</Badge>
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
              {e.type === "failed" && e.note && <p className="text-xs text-slate-600">{e.note}</p>}
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
