import type { Metadata } from "next";
import { prisma } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { DispatchBoard, type BoardDriver, type BoardOrder } from "./board";

export const metadata: Metadata = { title: "Despacho" };

export default async function DespachoPage() {
  await requireUser(["ADMIN", "DESPACHADOR"]);

  const [orders, drivers] = await Promise.all([
    prisma.order.findMany({
      where: { status: { in: ["CREATED", "RESCHEDULED", "FAILED", "ASSIGNED", "OUT_FOR_DELIVERY"] } },
      orderBy: { createdAt: "asc" },
      take: 2000,
      include: { client: { select: { name: true } } },
    }),
    prisma.driver.findMany({
      where: { active: true, user: { active: true } },
      include: { user: { select: { name: true } } },
      orderBy: [{ onDuty: "desc" }, { user: { name: "asc" } }],
    }),
  ]);

  const boardOrders: BoardOrder[] = orders.map((o) => ({
    id: o.id,
    code: o.code,
    status: o.status,
    client: o.client.name,
    recipient: o.recipientName,
    address: [o.addressLine, o.neighborhood, o.city].filter(Boolean).join(", "),
    zip: o.zip,
    lat: o.lat,
    lng: o.lng,
    driverId: o.driverId,
    attempts: o.attempts,
  }));
  const boardDrivers: BoardDriver[] = drivers.map((d) => ({
    id: d.id,
    name: d.user.name,
    onDuty: d.onDuty,
    lat: d.lastLat,
    lng: d.lastLng,
    lastLocationAt: d.lastLocationAt?.toISOString() ?? null,
  }));

  return (
    <div className="mx-auto max-w-[1600px]">
      <PageHeader eyebrow="Operación" title="Despacho">
        Selecciona pedidos en la lista o en el mapa y asígnalos a un repartidor. Se actualiza cada 30 segundos.
      </PageHeader>
      <DispatchBoard orders={boardOrders} drivers={boardDrivers} />
    </div>
  );
}
