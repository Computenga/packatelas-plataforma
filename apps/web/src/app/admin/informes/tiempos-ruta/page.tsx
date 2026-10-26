import type { Metadata } from "next";
import Link from "next/link";
import { prisma, quincenaOf, shiftQuincena, routeAnalysis, ymdMx } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import { readRange } from "@/lib/report-range";
import { Badge, ButtonLink, PageHeader, Table, Td } from "@/components/ui";
import { Stat } from "@/components/stat";
import { RangeForm } from "../range-form";

export const metadata: Metadata = { title: "Tiempos de ruta" };

const hm = (min: number) => `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")} min`;
const hora = (d: Date) => new Intl.DateTimeFormat("es-MX", { timeZone: "America/Mexico_City", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
const tone = (r: number | null) => (r == null ? "gray" : r > 1.3 ? "red" : r > 1.1 ? "amber" : "green");
const pct = (r: number | null) => (r == null ? "—" : `${Math.round(r * 100)} %`);

/** Tiempo esperado (OSRM, orden óptimo) contra tiempo real por repartidor [A26]. */
export default async function TiemposRutaPage({ searchParams }: PageProps<"/admin/informes/tiempos-ruta">) {
  await requireUser(["ADMIN"]);
  const sp = await searchParams;
  const q = quincenaOf(ymdMx(new Date()));
  const prev = shiftQuincena(q.key, -1);
  const { fromYmd, toYmd, range } = readRange(typeof sp.from === "string" ? sp : { from: q.from, to: q.to });
  const service = Math.min(60, Math.max(0, Number(sp.servicio) || 10));
  const driver = typeof sp.repartidor === "string" ? sp.repartidor : "";
  const { days, drivers, method } = await routeAnalysis(prisma, range, { serviceMinutes: service });
  const detail = driver ? days.filter((d) => d.driverId === driver) : [];
  const totals = drivers.reduce((s, d) => ({ stops: s.stops + d.stops, exp: s.exp + d.expectedMinutes, act: s.act + d.actualMinutes }), { stops: 0, exp: 0, act: 0 });
  const qs = (extra: Record<string, string>) => new URLSearchParams({ from: fromYmd, to: toYmd, servicio: String(service), ...extra }).toString();

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <PageHeader
        eyebrow="Informes"
        title="Tiempos de ruta"
        actions={
          <div className="flex gap-2">
            <ButtonLink href={`/admin/informes/exportar?${qs({ tab: "tiempos-ruta" })}`} variant="secondary" prefetch={false}>CSV por repartidor</ButtonLink>
            <ButtonLink href={`/admin/informes/exportar?${qs({ tab: "tiempos-ruta-dias" })}`} variant="secondary" prefetch={false}>CSV por día</ButtonLink>
          </div>
        }
      >
        Cuánto debió tardar cada repartidor en entregar lo que entregó (orden óptimo desde la bodega, {service} min por parada, entregas de 15:00 a 22:59) contra lo que tardó desde su salida.{" "}
        <Link href="/admin/informes" className="text-brand hover:underline">← Informes</Link>
      </PageHeader>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {[{ ...q, label: "Quincena actual" }, { ...prev, label: "Quincena anterior" }].map((p) => (
          <Link key={p.label} href={`/admin/informes/tiempos-ruta?${new URLSearchParams({ from: p.from, to: p.to, servicio: String(service) })}`}
            className={`rounded-lg border px-3 py-1.5 ${p.from === fromYmd && p.to === toYmd ? "border-brand bg-brand/5 font-medium text-brand" : "border-slate-200 bg-white text-slate-700"}`}>
            {p.label}
          </Link>
        ))}
        <form className="flex items-center gap-1">
          <input type="hidden" name="from" value={fromYmd} /><input type="hidden" name="to" value={toYmd} />
          <label className="text-slate-600">Min. por parada</label>
          <input type="number" name="servicio" min={0} max={60} defaultValue={service} className="w-16 rounded-lg border border-slate-300 px-2 py-1.5" />
          <button className="rounded-lg border border-slate-300 bg-white px-3 py-1.5">Aplicar</button>
        </form>
      </div>
      <RangeForm base="/admin/informes/tiempos-ruta" fromYmd={fromYmd} toYmd={toYmd} extra={{ servicio: String(service) }} />
      {method === "linea-recta" && days.length > 0 && (
        <p className="rounded-lg bg-amber-50 px-4 py-2 text-sm text-amber-800">El mapa de calles (OSRM) aún no responde: los tiempos de manejo se estiman en línea recta y pueden variar.</p>
      )}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Entregas analizadas" value={totals.stops} hint={`${days.length} rutas (repartidor-día)`} />
        <Stat label="Tiempo esperado" value={hm(totals.exp)} />
        <Stat label="Tiempo real" value={hm(totals.act)} tone={totals.act > totals.exp * 1.1 ? "amber" : "green"} />
        <Stat label="Entregas por hora" value={totals.act ? (totals.stops / (totals.act / 60)).toFixed(1) : "—"} hint="Todos los repartidores" />
      </div>
      <Table head={["Repartidor", "Días", "Entregas", "Esperado", "Real", "Real ÷ esperado", "Entregas/h", "Minutos de más"]} empty={drivers.length ? undefined : "Sin entregas con ubicación en el periodo (15:00 a 22:59)."}>
        {drivers.map((d) => (
          <tr key={d.driverId} className={`hover:bg-slate-50 ${d.driverId === driver ? "bg-brand/5" : ""}`}>
            <Td><Link href={`/admin/informes/tiempos-ruta?${qs(d.driverId === driver ? {} : { repartidor: d.driverId })}`} className="font-medium text-brand hover:underline">{d.driver}</Link></Td>
            <Td>{d.days}</Td>
            <Td>{d.stops}</Td>
            <Td>{hm(d.expectedMinutes)}</Td>
            <Td>{hm(d.actualMinutes)}</Td>
            <Td><Badge tone={tone(d.ratio)}>{pct(d.ratio)}</Badge></Td>
            <Td>{d.perHour ?? "—"}</Td>
            <Td>{d.extraMinutes ? hm(d.extraMinutes) : "—"}</Td>
          </tr>
        ))}
      </Table>
      {detail.length > 0 && (
        <>
          <h2 className="pt-2 text-lg font-semibold">{detail[0].driver}: detalle por día</h2>
          <Table head={["Día", "Entregas", "Salida", "1.ª entrega", "Última", "Manejo esperado", "Esperado", "Real", "Real ÷ esperado", "Sin ubicación"]}>
            {detail.map((d) => {
              const r = d.expectedMinutes ? d.actualMinutes / d.expectedMinutes : null;
              return (
                <tr key={d.day} className="hover:bg-slate-50">
                  <Td>{d.day}</Td><Td>{d.stops}</Td><Td>{hora(d.start)}</Td><Td>{hora(d.firstDelivery)}</Td><Td>{hora(d.lastDelivery)}</Td>
                  <Td>{hm(d.driveMinutes)}</Td><Td>{hm(d.expectedMinutes)}</Td><Td>{hm(d.actualMinutes)}</Td>
                  <Td><Badge tone={tone(r)}>{pct(r)}</Badge></Td><Td>{d.skippedNoLocation || "—"}</Td>
                </tr>
              );
            })}
          </Table>
        </>
      )}
      <p className="text-xs text-slate-500">
        Salida = último escaneo de carga antes de la primera entrega (nunca antes de las 15:00). Cuenta quien marcó la entrega. No cuentan recolecciones, destinos en la bodega ni entregas sin ubicación.
      </p>
    </div>
  );
}
