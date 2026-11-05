import type { Metadata } from "next";
import { driversWithoutLocation, prisma, todayMx } from "@packatelas/db";
import { NoLocationAlert } from "@/components/no-location-alert";
import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { DispatchBoard, type BoardDriver, type BoardOrder } from "./board";

export const metadata: Metadata = { title: "Despacho" };

export default async function DespachoPage() {
  await requireUser(["ADMIN", "DESPACHADOR"]);

  const [orders, drivers, lost] = await Promise.all([
    prisma.order.findMany({
      where: { kind: { in: ["DELIVERY", "RETURN"] }, source: { not: "IMPORT" }, status: { in: ["CREATED", "RESCHEDULED", "FAILED", "ASSIGNED", "OUT_FOR_DELIVERY", "RETURNING"] } },
      orderBy: { createdAt: "asc" },
      take: 2000,
      include: { client: { select: { name: true } } },
    }),
    prisma.driver.findMany({
      where: { active: true, user: { active: true } },
      include: { user: { select: { name: true } } },
      orderBy: [{ onDuty: "desc" }, { user: { name: "asc" } }],
    }),
    driversWithoutLocation(prisma),
  ]);
  const doneToday = await prisma.order.groupBy({
    by: ["driverId"],
    where: { status: "DELIVERED", deliveredAt: { gte: new Date(`${todayMx()}T00:00:00-06:00`) }, driverId: { not: null } },
    _count: { _all: true },
  });
  const done = new Map(doneToday.map((d) => [d.driverId, d._count._all]));

  const boardOrders: BoardOrder[] = orders.map((o) => ({
    id: o.id,
    code: o.code,
    status: o.status,
    client: o.client.name,
    recipient: o.recipientName,
    address: [o.addressLine, o.neighborhood, o.city].filter(Boolean).join(", "),
    neighborhood: o.neighborhood,
    city: o.city,
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
    deliveredToday: done.get(d.id) ?? 0,
  }));

  return (
    <div className="mx-auto max-w-[1600px]">
      <PageHeader eyebrow="Operación" title="Despacho">
        Elige una zona (o pedidos sueltos en la lista o el mapa) y asígnala a un repartidor. Se actualiza cada 30 segundos.
      </PageHeader>
      <NoLocationAlert drivers={lost} />
      <DispatchBoard orders={boardOrders} drivers={boardDrivers} />
    </div>
  );
}
