import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import { employeeOf } from "@/lib/employee-session";
import { fecha, mxn, startOfTodayMx } from "@/lib/format";
import { Card } from "@/components/ui";
import { BeforeRouteForm, MorningCheckForm } from "./forms";

export const metadata: Metadata = { title: "Mi moto" };

/** Flotilla desde la app del repartidor [A24]: check matutino, antes de ruta, gasolina y cargos. */
export default async function MotoPage({ searchParams }: PageProps<"/repartidor/moto">) {
  const user = await requireUser(["REPARTIDOR"]);
  const emp = await employeeOf(user.id);
  if (!emp) return <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">Tu usuario aún no está ligado a tu expediente. Pídelo en oficina para usar la flotilla.</p>;
  const tab = (await searchParams).tab === "ruta" ? "ruta" : "matutino";
  const today = startOfTodayMx();
  const [vehicles, myCheck, charges, openFaults] = await Promise.all([
    prisma.vehicle.findMany({ where: { status: { not: "BAJA" } }, select: { id: true, code: true, plate: true, km: true }, orderBy: { code: "asc" } }),
    prisma.vehicleCheck.findFirst({ where: { employeeId: emp.id, kind: "MATUTINO", at: { gte: today } }, include: { vehicle: { select: { code: true } } } }),
    prisma.employeeCharge.findMany({ where: { employeeId: emp.id }, orderBy: { createdAt: "desc" }, take: 10 }),
    prisma.fault.count({ where: { reportedById: emp.id, status: { in: ["ABIERTA", "EN_REPARACION"] } } }),
  ]);
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold">Mi moto</h1>
      {myCheck ? (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">Check matutino de hoy listo: {myCheck.vehicle.code} · {myCheck.km?.toLocaleString("es-MX")} km · {fecha(myCheck.at)}</p>
      ) : (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">Aún no haces el check matutino de hoy.</p>
      )}
      {openFaults > 0 && <p className="text-sm text-slate-600">{openFaults} falla(s) que reportaste siguen con el mecánico.</p>}
      <nav className="flex gap-1 overflow-x-auto border-b border-slate-200 text-sm">
        <Link href="/repartidor/moto" className={`-mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-2 ${tab === "matutino" ? "border-brand font-semibold text-brand" : "border-transparent text-slate-600"}`}>Check matutino</Link>
        <Link href="/repartidor/moto?tab=ruta" className={`-mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-2 ${tab === "ruta" ? "border-brand font-semibold text-brand" : "border-transparent text-slate-600"}`}>Antes de ruta</Link>
      </nav>
      <Card>
        {tab === "matutino" ? <MorningCheckForm vehicles={vehicles} defaultId={myCheck?.vehicleId} /> : <BeforeRouteForm vehicles={vehicles} defaultId={myCheck?.vehicleId} />}
      </Card>
      {charges.length > 0 && (
        <Card title="Mis cargos por reparaciones">
          <ul className="divide-y divide-slate-100 text-sm">
            {charges.map((c) => (
              <li key={c.id} className="flex justify-between gap-2 py-1.5">
                <span>{c.description}<span className="block text-xs text-slate-500">{fecha(c.createdAt)}</span></span>
                <span className="font-semibold">{mxn(c.amount)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
