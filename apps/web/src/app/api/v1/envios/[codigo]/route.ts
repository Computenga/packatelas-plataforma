import { prisma, STATUS_TEXT } from "@packatelas/db";
import { apiAuth, apiError, orderView } from "@/lib/api-v1";

// Igual que el portal: solo se comparte el motivo de no entrega o reprogramación.
const PUBLIC_NOTE = ["failed", "rescheduled", "return_required"];

/** Consultar un envío por código (PK-…, ML-…) o por la referencia del cliente, con su historial [I08]. */
export async function GET(request: Request, ctx: RouteContext<"/api/v1/envios/[codigo]">) {
  const { auth, error } = await apiAuth(request);
  if (error) return error;
  const { codigo } = await ctx.params;
  const key = decodeURIComponent(codigo).slice(0, 100);
  const order =
    (await prisma.order.findFirst({ where: { clientId: auth.clientId, code: key } })) ??
    (await prisma.order.findUnique({ where: { clientId_externalRef: { clientId: auth.clientId, externalRef: key } } }));
  if (!order) return apiError(404, "no_encontrado", "No existe un envío tuyo con ese código o referencia");
  const events = await prisma.orderEvent.findMany({
    where: { orderId: order.id, toStatus: { not: null } },
    orderBy: { occurredAt: "asc" },
    select: { type: true, toStatus: true, occurredAt: true, note: true },
  });
  return Response.json({
    envio: orderView(order),
    historial: events.map((e) => ({ estado: e.toStatus, estado_texto: e.toStatus ? STATUS_TEXT[e.toStatus] : null, ocurrio: e.occurredAt.toISOString(), nota: PUBLIC_NOTE.includes(e.type) ? e.note : null })),
  });
}
