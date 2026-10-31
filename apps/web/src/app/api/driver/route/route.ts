import { IN_ROUTE, orderStops, prisma } from "@packatelas/db";
import { getDriverSession, unauthorized } from "@/lib/driver-api";

/** Pedidos en ruta del repartidor, ordenados desde su ubicación actual [R02]. */
export async function GET(request: Request) {
  const s = await getDriverSession();
  if (!s) return unauthorized();
  const params = new URL(request.url).searchParams;
  const lat = Number(params.get("lat"));
  const lng = Number(params.get("lng"));
  const hasPos = params.has("lat") && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
  const start = hasPos ? { lat, lng } : s.driver.lastLat != null && s.driver.lastLng != null ? { lat: s.driver.lastLat, lng: s.driver.lastLng } : null;

  const orders = await prisma.order.findMany({
    where: { driverId: s.driver.id, kind: "DELIVERY", status: { in: IN_ROUTE } },
    include: { client: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });
  const { ordered, method, etaSeconds } = await orderStops(start, orders);

  return Response.json({
    method,
    orders: ordered.map((o, i) => ({
      id: o.id,
      code: o.code,
      status: o.status,
      client: o.client.name,
      recipient: o.recipientName,
      phone: o.recipientPhone,
      address: [o.addressLine, o.neighborhood, o.city].filter(Boolean).join(", "),
      zip: o.zip,
      instructions: o.instructions,
      lat: o.lat,
      lng: o.lng,
      etaMin: etaSeconds?.[i] != null && o.lat != null ? Math.round(etaSeconds[i] / 60) : null,
    })),
  });
}
