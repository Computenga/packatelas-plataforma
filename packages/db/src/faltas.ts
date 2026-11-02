// Faltas graves del repartidor. «not_visited» en MercadoLibre (el repartidor marcó que no visitó el
// domicilio) afecta la reputación del vendedor y de Packatelas: todos los administradores reciben un
// aviso urgente (push + app Android) para corregirlo y revisarlo con el repartidor. Una vez por envío.
import type { PrismaClient } from "../generated/prisma/client.ts";
import { addOrderEvent } from "./orders.ts";
import { adminUserIds, sendPush } from "./push.ts";

const KEY = "falta.not_visited";

export const isNotVisited = (status?: string | null, substatus?: string | null) =>
  [status, substatus].some((s) => (s ?? "").toLowerCase() === "not_visited");

/** Avisa (una sola vez por envío) que un paquete quedó como «no visitado» en ML. */
export async function alertNotVisited(prisma: PrismaClient, shipmentId: bigint, opts: { orderId?: string | null; now?: Date } = {}) {
  const row = await prisma.setting.findUnique({ where: { key: KEY } });
  const seen = (row?.value as string[] | undefined) ?? [];
  const id = shipmentId.toString();
  if (seen.includes(id)) return false;
  await prisma.setting.upsert({ where: { key: KEY }, update: { value: [...seen, id].slice(-1000) }, create: { key: KEY, value: [id] } });

  const order = opts.orderId
    ? await prisma.order.findUnique({ where: { id: opts.orderId }, select: { id: true, code: true, client: { select: { name: true } }, driver: { select: { user: { select: { name: true } } } } } })
    : await prisma.order.findUnique({ where: { mlShipmentId: shipmentId }, select: { id: true, code: true, client: { select: { name: true } }, driver: { select: { user: { select: { name: true } } } } } });
  const driver = order?.driver?.user.name ?? "repartidor sin identificar";
  if (order) {
    await addOrderEvent(prisma, {
      orderId: order.id, type: "falta_not_visited", source: "ML_SYNC",
      note: `FALTA GRAVE: en MercadoLibre quedó como «no visitado» (${driver}). Corregir y revisar con el repartidor.`,
      data: { shipmentId: id },
    }).catch(() => {});
  }
  await sendPush(prisma, await adminUserIds(prisma), {
    title: "🚨 Falta grave: paquete «no visitado» en ML",
    body: `${order?.code ?? `ML-${id}`} · ${driver}${order ? ` · ${order.client.name}` : ""}. Corrígelo en MercadoLibre y revísalo con el repartidor.`,
    url: order ? `/admin/pedidos/${order.id}` : `/admin/pedidos?q=${id}`,
    tag: `not-visited-${id}`,
  });
  return true;
}
