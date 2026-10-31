import type { Metadata } from "next";
import Link from "next/link";
import { driversWithoutLocation, prisma } from "@packatelas/db";
import { NoLocationAlert } from "@/components/no-location-alert";
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

  const [ordersToday, pending, delivered, clients, driversOnDuty, drivers, balance, lost, failed, toWarehouse, unidentified, signups] = await Promise.all([
    prisma.order.count({ where: { kind: "DELIVERY", createdAt: { gte: today } } }),
    prisma.order.count({ where: { kind: "DELIVERY", status: { in: ["CREATED", "ASSIGNED", "OUT_FOR_DELIVERY", "RESCHEDULED"] } } }),
    prisma.order.count({ where: { kind: "DELIVERY", status: "DELIVERED", deliveredAt: { gte: today } } }),
    prisma.client.count({ where: { active: true } }),
    prisma.driver.count({ where: { active: true, onDuty: true } }),
    prisma.driver.count({ where: { active: true } }),
    user.role === "ADMIN" ? prisma.ledgerEntry.aggregate({ _sum: { amount: true } }) : null,
    driversWithoutLocation(prisma),
    prisma.order.count({ where: { kind: "DELIVERY", status: "FAILED" } }),
    prisma.order.count({ where: { status: "RETURNING" } }),
    user.role === "ADMIN" ? prisma.payment.count({ where: { status: "UNIDENTIFIED" } }) : 0,
    user.role === "ADMIN" ? prisma.clientSignup.count({ where: { status: "PENDING" } }) : 0,
  ]);
  const todo = [
    failed > 0 && { href: "/admin/pedidos?vista=vivo&status=FAILED", text: `${failed} fallido(s) por decidir: reprogramar o regresar a bodega` },
    toWarehouse > 0 && { href: "/admin/devoluciones", text: `${toWarehouse} paquete(s) que deben llegar a bodega` },
    unidentified > 0 && { href: "/admin/cobros", text: `${unidentified} transferencia(s) sin identificar` },
    signups > 0 && { href: "/admin/clientes/solicitudes", text: `${signups} tienda(s) nueva(s) esperando aprobación` },
  ].filter(Boolean) as { href: string; text: string }[];

  return (
    <div className="mx-auto max-w-6xl">
      <p className="text-xs font-semibold uppercase tracking-wider text-brand">Administración</p>
      <h1 className="mt-1 text-2xl font-bold">Resumen de hoy</h1>

      <div className="mt-4">
        <NoLocationAlert drivers={lost} />
      </div>

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

      {todo.length > 0 && (
        <section className="mt-8 rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="font-semibold">Pendientes</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {todo.map((t) => (
              <li key={t.href}>
                <Link href={t.href} className="text-brand hover:underline">{t.text}</Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
