import type { Metadata } from "next";
import Link from "next/link";
import { expiringDocuments, fleetReport, prisma, vehiclesWithoutMorningCheck, DOC_TYPES } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import { mxn } from "@/lib/format";
import { readRange } from "@/lib/report-range";
import { Badge, ButtonLink, Card, PageHeader, Table, Td } from "@/components/ui";
import { Stat } from "@/components/stat";
import { RangeForm } from "../informes/range-form";

export const metadata: Metadata = { title: "Flotilla" };
const CHECK_DEADLINE_HOUR = 11;
const nowMs = () => Date.now();
const hourMx = (t: number) => Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Mexico_City", hour: "numeric", hour12: false }).format(t));

/** Tablero de flotilla [A24]: alertas, costos por moto y por empleado, tiempos del mecánico. */
export default async function FlotillaPage({ searchParams }: PageProps<"/admin/flotilla">) {
  await requireUser(["ADMIN"]);
  const { fromYmd, toYmd, range } = readRange(await searchParams);
  const t = nowMs();
  const [report, docs, missing, openFaults, oldFaults, employees] = await Promise.all([
    fleetReport(prisma, range.from, range.to),
    expiringDocuments(prisma, 30),
    vehiclesWithoutMorningCheck(prisma),
    prisma.fault.count({ where: { status: { in: ["ABIERTA", "EN_REPARACION"] } } }),
    prisma.fault.count({ where: { status: "ABIERTA", createdAt: { lt: new Date(t - 24 * 3600_000) } } }),
    prisma.employee.findMany({ select: { id: true, name: true, employeeNo: true } }),
  ]);
  const name = new Map(employees.map((e) => [e.id, `${e.name} (U-${e.employeeNo})`]));
  const afterDeadline = hourMx(t) >= CHECK_DEADLINE_HOUR;
  const totals = report.byVehicle.reduce((a, v) => ({ fuel: a.fuel + v.fuelCost, repair: a.repair + v.repairCost, km: a.km + v.km }), { fuel: 0, repair: 0, km: 0 });

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <PageHeader
        eyebrow="Interno"
        title="Flotilla"
        actions={<><ButtonLink href="/mecanico" variant="secondary">Fallas</ButtonLink><ButtonLink href="/mecanico/documentos" variant="secondary">Documentos</ButtonLink><ButtonLink href="/mecanico/motos" variant="secondary">Motos</ButtonLink></>}
      >
        Checks, gasolina, fallas, reparaciones y vigencias. Los repartidores hacen sus checks en la app (pestaña Moto).
      </PageHeader>

      <div className="grid gap-3 md:grid-cols-3">
        <Card title="Documentos por vencer (30 días)">
          {docs.length === 0 ? <p className="text-sm text-slate-500">Todo vigente.</p> : (
            <ul className="space-y-1 text-sm">
              {docs.slice(0, 8).map((d) => (
                <li key={d.id} className="flex justify-between gap-2">
                  <span>{d.vehicle.code} · {DOC_TYPES[d.type] ?? d.type}</span>
                  <Badge tone={d.daysLeft < 0 || d.daysLeft <= 7 ? "red" : "amber"}>{d.daysLeft < 0 ? "vencido" : `${d.daysLeft} d`}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Check matutino de hoy">
          {missing.length === 0 ? <p className="text-sm text-emerald-700">Todas las motos activas tienen check.</p> : (
            <p className={`text-sm ${afterDeadline ? "text-red-700" : "text-slate-600"}`}>
              {afterDeadline ? "Pasadas las 11:00 sin check: " : "Pendientes: "}{missing.map((v) => v.code).join(", ")}
            </p>
          )}
        </Card>
        <Card title="Taller">
          <p className="text-sm">{openFaults} falla(s) abiertas o en reparación{oldFaults > 0 && <span className="text-red-600"> · {oldFaults} sin atender más de 24 h</span>}</p>
          <p className="mt-1 text-xs text-slate-500">
            Promedio en el periodo: respuesta {report.mechanic.avgResponseHours ?? "—"} h · reparación {report.mechanic.avgRepairHours ?? "—"} h ({report.mechanic.repairs} cerradas)
          </p>
          <Link href="/mecanico" className="mt-2 inline-block text-sm text-brand hover:underline">Ver fallas →</Link>
        </Card>
      </div>

      <RangeForm base="/admin/flotilla" fromYmd={fromYmd} toYmd={toYmd} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Km recorridos" value={totals.km.toLocaleString("es-MX")} />
        <Stat label="Gasolina" value={mxn(totals.fuel)} tone="amber" />
        <Stat label="Reparaciones" value={mxn(totals.repair)} tone="red" />
        <Stat label="Costo por km" value={totals.km ? mxn((totals.fuel + totals.repair) / totals.km) : "—"} />
      </div>

      <Table head={["Moto", "Tamaño", "Estatus", "Km", "Gasolina", "Litros", "Km/litro", "Reparaciones", "Costo reparación", "Costo/km"]}>
        {report.byVehicle.map((v) => (
          <tr key={v.id}>
            <Td className="font-medium">{v.code} <span className="text-xs text-slate-500">{v.plate}</span></Td>
            <Td>{v.size}</Td>
            <Td><Badge tone={v.status === "ACTIVO" ? "green" : v.status === "TALLER" ? "amber" : "gray"}>{v.status === "ACTIVO" ? "Activa" : v.status === "TALLER" ? "Taller" : "Baja"}</Badge></Td>
            <Td className="text-right tabular-nums">{v.km.toLocaleString("es-MX")}</Td>
            <Td className="text-right tabular-nums">{mxn(v.fuelCost)}</Td>
            <Td className="text-right tabular-nums">{v.liters ? v.liters.toFixed(1) : "—"}</Td>
            <Td className="text-right tabular-nums">{v.kmPerLiter ?? "—"}</Td>
            <Td className="text-right tabular-nums">{v.repairs}</Td>
            <Td className="text-right tabular-nums">{mxn(v.repairCost)}</Td>
            <Td className="text-right tabular-nums">{v.costPerKm != null ? mxn(v.costPerKm) : "—"}</Td>
          </tr>
        ))}
      </Table>

      <Card title="Por empleado">
        <Table head={["Empleado", "Km (checks matutinos)", "Gasolina", "Cargos por reparaciones"]} empty={report.byEmployee.length ? undefined : "Sin movimientos en el periodo"}>
          {report.byEmployee.sort((a, b) => b.km - a.km).map((e) => (
            <tr key={e.employeeId}>
              <Td>{name.get(e.employeeId) ?? "—"}</Td>
              <Td className="text-right tabular-nums">{e.km.toLocaleString("es-MX")}</Td>
              <Td className="text-right tabular-nums">{mxn(e.fuelCost)}</Td>
              <Td className={`text-right tabular-nums ${e.charges ? "text-red-600" : ""}`}>{mxn(e.charges)}</Td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}
