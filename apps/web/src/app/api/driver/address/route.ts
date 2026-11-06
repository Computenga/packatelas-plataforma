import { addOrderEvent, ML_PENDING_ADDRESS, prisma } from "@packatelas/db";
import { getDriverSession, unauthorized } from "@/lib/driver-api";
import { geocodeAddress } from "@/lib/geocode-providers";

/**
 * Envío de una cuenta de ML que no ha autorizado a Packatelas (sin datos del comprador): el
 * repartidor escribe la dirección y el nombre que trae la etiqueta para poder ubicarlo en su ruta.
 */
export async function POST(request: Request) {
  const s = await getDriverSession();
  if (!s) return unauthorized();
  const b = (await request.json().catch(() => null)) as { orderId?: string; address?: string; recipient?: string } | null;
  const address = (b?.address ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
  const recipient = (b?.recipient ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
  if (!b?.orderId || address.length < 8) return Response.json({ error: "Escribe la dirección completa (calle, número, colonia)" }, { status: 400 });
  const o = await prisma.order.findFirst({ where: { id: b.orderId, driverId: s.driver.id }, select: { id: true, addressLine: true, recipientName: true } });
  if (!o) return Response.json({ error: "Ese pedido no está en tu ruta" }, { status: 404 });
  if (o.addressLine !== ML_PENDING_ADDRESS && o.addressLine) return Response.json({ error: "Este pedido ya tiene dirección" }, { status: 409 });
  const hit = await geocodeAddress(`${address}, México`).catch(() => null);
  await prisma.order.update({
    where: { id: o.id },
    data: { addressLine: address, ...(recipient && !o.recipientName ? { recipientName: recipient } : {}), ...(hit ? { lat: hit.lat, lng: hit.lng } : {}) },
  });
  await addOrderEvent(prisma, { orderId: o.id, type: "address_captured", source: "DRIVER_APP", actorUserId: s.user.id, note: `Dirección capturada por el repartidor de la etiqueta: ${address}${recipient ? ` · Recibe: ${recipient}` : ""}` });
  return Response.json({ ok: true, located: !!hit });
}
