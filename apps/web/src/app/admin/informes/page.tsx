import type { Metadata } from "next";
import Link from "next/link";
import { BREAK_EVEN_PER_DAY, clientReport, deliveriesByHour, deliveryPoints, driverReport, prisma, zoneReport } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import { mxn } from "@/lib/format";
import { readRange } from "@/lib/report-range";
import { Badge, ButtonLink, Card, PageHeader, Table, Td } from "@/components/ui";
import { Stat } from "@/components/stat";
import { RangeForm } from "./range-form";
import { HourChart } from "./hour-chart";
import { HeatMap } from "./heat-map";


export const metadata: Metadata = { title: "Informes" };

const TABS = [
  { key: "repartidores", label: "Repartidores" },
  { key: "clientes", label: "Clientes" },
  { key: "zonas", label: "Zonas" },
  { key: "mapa", label: "Horas y mapa" },
] as const;
type Tab = (typeof TABS)[number]["key"];

export default async function InformesPage({ searchParams }: PageProps<"/admin/informes">) {
  await requireUser(["ADMIN"]);
  const sp = await searchParams;
  const tab: Tab = TABS.find((t) => t.key === sp.tab)?.key ?? "repartidores";
  const zoneBy = sp.por === "cp" ? "zip" : "city";
  const { fromYmd, toYmd, range } = readRange(sp);
  const qs = (extra: Record<string, string>) => new URLSearchParams({ from: fromYmd, to: toYmd, ...extra }).toString();

  const [drivers, clients, zones, hours, points, created] = await Promise.all([
    tab === "repartidores" ? driverReport(prisma, range) : Promise.resolve([]),
    tab === "clientes" ? clientReport(prisma, range) : Promise.resolve([]),
    tab === "zonas" ? zoneReport(prisma, range, zoneBy) : Promise.resolve([]),
    tab === "mapa" || tab === "repartidores" ? deliveriesByHour(prisma, range) : Promise.resolve(new Array(24).fill(0)),
    tab === "mapa" ? deliveryPoints(prisma, range) : Promise.resolve([] as [number, number][]),
    prisma.order.count({ where: { createdAt: { gte: range.from, lt: range.to }, status: { not: "CANCELLED" } } }),
  ]);
  const delivered = hours.reduce((a: number, b: number) => a + b, 0);

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <PageHeader
        eyebrow="Gestión"
        title="Informes"
        actions={tab !== "mapa" && <ButtonLink href={`/admin/informes/exportar?${qs({ tab, ...(tab === "zonas" ? { por: sp.por === "cp" ? "cp" : "" } : {}) })}`} variant="secondary" prefetch={false}>Exportar CSV</ButtonLink>}
      >
        Desempeño por repartidor, cliente y zona. <Link href={`/admin/informes/carga-quemada?${qs({})}`} className="text-brand hover:underline">Ver carga quemada →</Link>{" "}
        <Link href="/admin/informes/tiempos-ruta" className="text-brand hover:underline">Tiempos de ruta →</Link>
      </PageHeader>
      <RangeForm base="/admin/informes" fromYmd={fromYmd} toYmd={toYmd} extra={{ tab }} />
      <nav className="flex gap-1 overflow-x-auto border-b border-slate-200 text-sm" aria-label="Informes">
        {TABS.map((t) => (
          <Link key={t.key} href={`/admin/informes?${qs({ tab: t.key })}`} aria-current={tab === t.key ? "page" : undefined}
            className={`-mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-2 ${tab === t.key ? "border-brand font-semibold text-brand" : "border-transparent text-slate-600 hover:text-slate-900"}`}>
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === "repartidores" && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Envíos registrados" value={created.toLocaleString("es-MX")} />
            <Stat label="Entregas" value={delivered.toLocaleString("es-MX")} tone="green" />
            <Stat label="Repartidores con entregas" value={drivers.filter((d) => d.delivered).length} />
            <Stat label={`Bajo la meta (${BREAK_EVEN_PER_DAY}/día)`} value={drivers.filter((d) => d.days && d.perDay < BREAK_EVEN_PER_DAY).length} tone="amber" hint="Promedio diario en el periodo" />
          </div>
          <Table head={["Repartidor", "Entregas", "No entregados", "Efectividad", "Días", "Promedio/día", "En horario extra", "23 h o después", "Min. carga→entrega"]} empty={drivers.length ? undefined : "Sin entregas en el periodo"}>
            {drivers.map((d) => (
              <tr key={d.driverId} className="hover:bg-slate-50">
                <Td className="font-medium">{d.name}</Td>
                <Td className="text-right tabular-nums">{d.delivered}</Td>
                <Td className="text-right tabular-nums">{d.failed}</Td>
                <Td className="text-right tabular-nums">{d.effectiveness}%</Td>
                <Td className="text-right tabular-nums">{d.days}</Td>
                <Td className="text-right tabular-nums">
                  {d.perDay} {d.days > 0 && d.perDay < BREAK_EVEN_PER_DAY && <Badge tone="amber">bajo meta</Badge>}
                </Td>
                <Td className="text-right tabular-nums">{d.overtime}</Td>
                <Td className={`text-right tabular-nums ${d.afterHours ? "text-red-600" : ""}`}>{d.afterHours}</Td>
                <Td className="text-right tabular-nums">{d.avgMinutes ?? "—"}</Td>
              </tr>
            ))}
          </Table>
          <p className="text-xs text-slate-500">Las entregas cuentan para quien las cerró en la app. &quot;23 h o después&quot; no cuenta como horario extra pagado.</p>
        </>
      )}

      {tab === "clientes" && (
        <Table head={["Cliente", "Envíos", "Entregados", "Efectividad", "Intentos fallidos", "Devoluciones", "Cargos"]} empty={clients.length ? undefined : "Sin envíos en el periodo"}>
          {clients.map((c) => (
            <tr key={c.clientId} className="hover:bg-slate-50">
              <Td><Link href={`/admin/cobros/${c.clientId}`} className="font-medium text-brand hover:underline">{c.name}</Link> <span className="font-mono text-[11px] text-slate-400">{c.publicId}</span></Td>
              <Td className="text-right tabular-nums">{c.created}</Td>
              <Td className="text-right tabular-nums">{c.delivered}</Td>
              <Td className="text-right tabular-nums">{c.created ? Math.round((c.delivered / c.created) * 100) : 0}%</Td>
              <Td className="text-right tabular-nums">{c.failedAttempts}</Td>
              <Td className="text-right tabular-nums">{c.returned}</Td>
              <Td className="text-right tabular-nums">{mxn(c.charged)}</Td>
            </tr>
          ))}
        </Table>
      )}

      {tab === "zonas" && (
        <>
          <div className="flex gap-3 text-sm">
            <Link href={`/admin/informes?${qs({ tab: "zonas" })}`} className={zoneBy === "city" ? "font-semibold text-brand" : "text-slate-500"}>Por alcaldía / municipio</Link>
            <Link href={`/admin/informes?${qs({ tab: "zonas", por: "cp" })}`} className={zoneBy === "zip" ? "font-semibold text-brand" : "text-slate-500"}>Por código postal</Link>
          </div>
          <Table head={[zoneBy === "zip" ? "CP" : "Alcaldía / municipio", "Envíos", "Entregados", "Con intento fallido", "Efectividad"]} empty={zones.length ? undefined : "Sin envíos con dirección en el periodo"}>
            {zones.map((z) => (
              <tr key={z.zone} className="hover:bg-slate-50">
                <Td>{z.zone}</Td>
                <Td className="text-right tabular-nums">{z.created}</Td>
                <Td className="text-right tabular-nums">{z.delivered}</Td>
                <Td className="text-right tabular-nums">{z.failed}</Td>
                <Td className={`text-right tabular-nums ${z.effectiveness && z.effectiveness < 85 ? "text-red-600" : ""}`}>{z.delivered + z.failed ? `${z.effectiveness}%` : "—"}</Td>
              </tr>
            ))}
          </Table>
          <p className="text-xs text-slate-500">Envíos de MercadoLibre sin sincronizar (sin dirección) no aparecen hasta que se conecte la API.</p>
        </>
      )}

      {tab === "mapa" && (
        <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
          <Card title={`Dónde entregamos (${points.length.toLocaleString("es-MX")} entregas con ubicación)`}>
            <HeatMap points={points} />
          </Card>
          <Card title="Entregas por hora">
            <HourChart data={hours} />
          </Card>
        </div>
      )}
    </div>
  );
}
