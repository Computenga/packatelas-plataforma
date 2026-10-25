import type { Metadata } from "next";
import { prisma } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import { STAFF_ROLES } from "@/lib/roles";
import { Stat, mxn } from "@/components/stat";

export const metadata: Metadata = { title: "Resumen" };

function startOfTodayMx() {
  const now = new Date();
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(now);
  return new Date(`${ymd}T00:00:00-06:00`);
}

export default async function AdminHome() {
  const user = await requireUser(STAFF_ROLES);
  const today = startOfTodayMx();

  const [ordersToday, pending, delivered, clients, driversOnDuty, drivers, balance] = await Promise.all([
    prisma.order.count({ where: { createdAt: { gte: today } } }),
    prisma.order.count({ where: { status: { in: ["CREATED", "ASSIGNED", "OUT_FOR_DELIVERY"] } } }),
    prisma.order.count({ where: { status: "DELIVERED", deliveredAt: { gte: today } } }),
    prisma.client.count({ where: { active: true } }),
    prisma.driver.count({ where: { active: true, onDuty: true } }),
    prisma.driver.count({ where: { active: true } }),
    user.role === "ADMIN" ? prisma.ledgerEntry.aggregate({ _sum: { amount: true } }) : null,
  ]);

  return (
    <div className="mx-auto max-w-6xl">
      <p className="text-xs font-semibold uppercase tracking-wider text-brand">Administración</p>
      <h1 className="mt-1 text-2xl font-bold">Resumen de hoy</h1>

      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Pedidos hoy" value={ordersToday} />
        <Stat label="En proceso" value={pending} tone="amber" hint="Creados, asignados o en reparto" />
        <Stat label="Entregados hoy" value={delivered} tone="green" />
        <Stat label="Repartidores en turno" value={`${driversOnDuty}/${drivers}`} />
        <Stat label="Clientes activos" value={clients} />
        {balance && (
          <Stat label="Saldo por cobrar" value={mxn(balance._sum.amount?.toString() ?? 0)} tone="red" />
        )}
      </div>

      <section className="mt-8 rounded-xl border border-dashed border-slate-300 bg-white p-6">
        <h2 className="font-semibold">Fase 1 en construcción</h2>
        <p className="mt-1 text-sm text-slate-600">
          Las secciones marcadas como &quot;pronto&quot; se irán habilitando: escaneo de envíos ML, despacho con mapa
          y rutas, pedidos, devoluciones, clientes, repartidores y cobros.
        </p>
      </section>
    </div>
  );
}
