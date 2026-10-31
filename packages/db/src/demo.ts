// Flujo de prueba de punta a punta en producción: cliente DEMO (sin cobro), un envío PK-… con el
// celular de quien prueba como destinatario, y una recolección RC-… cuya sucursal tiene ese mismo
// celular. Todo queda marcado como demo y se puede borrar después.
import type { PrismaClient } from "../generated/prisma/client.ts";
import { createManualOrder, audit } from "./orders.ts";
import { requestPickup, todayMx } from "./pickups.ts";
import { waPhone } from "./notifications.ts";

export const DEMO_PUBLIC_ID = "demo00001";

export async function createDemoFlow(prisma: PrismaClient, input: { phone: string; actorUserId?: string }) {
  const wa = waPhone(input.phone);
  if (!wa) throw new Error("Escribe un celular de 10 dígitos");
  const phone = wa.slice(2);
  const client = await prisma.client.upsert({
    where: { publicId: DEMO_PUBLIC_ID },
    update: { phone, active: true },
    create: {
      publicId: DEMO_PUBLIC_ID,
      name: "DEMO Packatelas (prueba, borrar)",
      contactName: "Prueba",
      phone,
      paymentReference: "DEMO00001",
      tariffAmount: 0,
      chargingEnabled: false,
      creditMode: "WEEKLY_CREDIT",
    },
  });
  let branch = await prisma.branch.findFirst({ where: { clientId: client.id, name: "Sucursal demo" } });
  if (!branch) {
    branch = await prisma.branch.create({
      data: { clientId: client.id, name: "Sucursal demo", address: "Av. Paseo de la Reforma 222, Juárez, Cuauhtémoc, CDMX", lat: 19.4285, lng: -99.1625, phone },
    });
  } else if (branch.phone !== phone) {
    branch = await prisma.branch.update({ where: { id: branch.id }, data: { phone } });
  }
  const order = await createManualOrder(
    prisma,
    {
      clientId: client.id,
      branchId: branch.id,
      recipientName: "Prueba Packatelas",
      recipientPhone: phone,
      addressLine: "Av. Insurgentes Sur 1235",
      neighborhood: "Del Valle",
      city: "Benito Juárez",
      state: "CDMX",
      zip: "03100",
      lat: 19.3746,
      lng: -99.1784,
      itemsSummary: "1× Paquete de prueba",
      instructions: "ENVÍO DE PRUEBA — no es un paquete real",
      eventSource: "ADMIN",
    },
    input.actorUserId,
  );
  const pickup = await requestPickup(prisma, { clientId: client.id, branchId: branch.id, ymd: todayMx(), expectedCount: 1, note: "Recolección de prueba" }, input.actorUserId);
  const pickupOrder = await prisma.order.findUnique({ where: { pickupId: pickup.id }, select: { id: true, code: true } });
  await audit(prisma, { actorUserId: input.actorUserId, action: "demo.created", entity: "Order", entityId: order.id, summary: `Flujo demo: ${order.code} y ${pickupOrder?.code ?? "recolección"} para ${phone}` });
  return { orderId: order.id, code: order.code, pickupId: pickup.id, pickupStatus: pickup.status, pickupOrderId: pickupOrder?.id ?? null, pickupCode: pickupOrder?.code ?? null };
}
