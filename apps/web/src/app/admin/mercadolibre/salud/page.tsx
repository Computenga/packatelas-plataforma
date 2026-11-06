import type { Metadata } from "next";
import Link from "next/link";
import { mlLiveProbe, mlNotificationStats, mlQueueHealth, prisma } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import { fecha, STATUS_LABEL } from "@/lib/format";
import { Badge, ButtonLink, Card, PageHeader, Table, Td } from "@/components/ui";

export const metadata: Metadata = { title: "Salud de MercadoLibre" };
export const dynamic = "force-dynamic";
const clock = () => Date.now();

const VERDICT: Record<string, { label: string; tone: "gray" | "blue" | "green" | "amber" | "red"; help: string }> = {
  desfasado: { label: "Desfasado", tone: "red", help: "ML ya cambió el estado y el portal no se enteró (falla de avisos o de la cola)." },
  solo_app: { label: "Solo en la app", tone: "amber", help: "El repartidor lo entregó en nuestra app pero en ML no figura entregado (no lo marcó en la app Flex)." },
  solo_ml: { label: "Solo en ML", tone: "amber", help: "ML dice entregado pero en nuestra app no hay evidencia." },
  cerrado_ml: { label: "Cancelado o devuelto en ML", tone: "amber", help: "ML lo canceló o lo dio por no entregado/devuelto, pero en el portal sigue en ruta: hay que regresarlo a bodega o quitarlo de la ruta." },
  pendiente: { label: "Pendiente", tone: "blue", help: "Sin entregar en ninguno de los dos: el paquete sigue en ruta." },
  ok: { label: "Coincide", tone: "green", help: "Entregado en los dos." },
  error: { label: "Sin respuesta", tone: "gray", help: "ML no respondió o la cuenta no está autorizada." },
};
const ML_ES: Record<string, string> = { shipped: "en camino", delivered: "entregado", not_delivered: "no entregado", ready_to_ship: "listo para enviar", cancelled: "cancelado", pending: "pendiente", handling: "en preparación" };
const ml = (s: string | null, sub?: string | null) => (s ? `${ML_ES[s] ?? s}${sub ? ` · ${sub.replace(/_/g, " ")}` : ""}` : "—");
const hace = (d: Date | null, now: number) => {
  if (!d) return "nunca";
  const m = Math.round((now - d.getTime()) / 60_000);
  return m < 1 ? "hace menos de 1 min" : m < 90 ? `hace ${m} min` : `hace ${Math.round(m / 60)} h`;
};

export default async function MlHealthPage({ searchParams }: PageProps<"/admin/mercadolibre/salud">) {
  await requireUser(["ADMIN"]);
  const sp = await searchParams;
  const probe = sp.probar === "1";
  const now = clock();
  const [notif, queue, live] = await Promise.all([
    mlNotificationStats(prisma),
    mlQueueHealth(prisma),
    probe ? mlLiveProbe(prisma, { limit: 150, resync: sp.resync === "1" }) : Promise.resolve(null),
  ]);

  const notifLevel = !notif.lastAt ? "gray" : now - notif.lastAt.getTime() < 20 * 60_000 ? "green" : now - notif.lastAt.getTime() < 60 * 60_000 ? "amber" : "red";
  const queueLevel = queue.overdue > 20 ? "red" : queue.overdue > 0 || queue.failed24 > 0 ? "amber" : "green";
  const maxHour = Math.max(1, ...notif.hours.map((h) => h.count));

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader eyebrow="MercadoLibre" title="Salud de la API de MercadoLibre"
        actions={<ButtonLink href="/admin/mercadolibre/salud?probar=1">Probar ahora con los pedidos de hoy</ButtonLink>}>
        Sirve para saber si un estado atrasado es falla de MercadoLibre (avisos, límites, intermitencia) o un paquete que de verdad no se ha entregado.
      </PageHeader>

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="1. Avisos que manda MercadoLibre">
          <p className="text-sm"><Badge tone={notifLevel}>{notifLevel === "green" ? "Llegando" : notifLevel === "amber" ? "Lentos" : notifLevel === "red" ? "Detenidos" : "Sin datos aún"}</Badge> Último aviso {hace(notif.lastAt, now)} · {notif.total24} en 24 h</p>
          <div className="mt-3 flex h-16 items-end gap-0.5" aria-label="Avisos por hora, últimas 24 horas">
            {notif.hours.map((h) => (
              <div key={h.hour.toISOString()} title={`${new Intl.DateTimeFormat("es-MX", { timeZone: "America/Mexico_City", hour: "numeric" }).format(h.hour)}: ${h.count}`}
                className="flex-1 rounded-t-sm bg-brand/70" style={{ height: `${Math.max(2, (h.count / maxHour) * 100)}%` }} />
            ))}
          </div>
          <p className="mt-1 text-xs text-slate-500">Por hora, últimas 24 h (el conteo empezó con esta versión). Si de día pasan más de 20 min sin avisos, ML dejó de notificar o la URL de avisos falla.</p>
        </Card>
        <Card title="2. Cola de sincronización">
          <p className="text-sm"><Badge tone={queueLevel}>{queueLevel === "green" ? "Al día" : queueLevel === "amber" ? "Con atrasos" : "Atorada"}</Badge> Última sincronización {hace(queue.jobs.lastAt, now)}</p>
          <ul className="mt-2 space-y-1 text-sm">
            <li>Envíos revisados: {queue.jobs.last15} en 15 min · {queue.jobs.last60} en 1 h · {queue.jobs.last24h} en 24 h</li>
            <li>En espera: {queue.pending} ({queue.overdue} atrasados más de 2 min)</li>
            <li>Fallidos definitivos en 24 h: {queue.failed24}</li>
          </ul>
          {queue.errors.length > 0 && (
            <div className="mt-3 text-xs">
              <p className="font-semibold">Errores frecuentes (24 h)</p>
              <ul className="mt-1 space-y-0.5">
                {queue.errors.map((e) => (
                  <li key={e.error}><span className="font-mono">{e.count}×</span> {e.error}{/429/.test(e.error) && <Badge tone="red">Límite de ML</Badge>}</li>
                ))}
              </ul>
            </div>
          )}
          <p className="mt-2 text-xs text-slate-500">Además de los avisos, cada 10 min se vuelven a revisar los pedidos en ruta que no se sincronizan hace 20 min.</p>
        </Card>
      </div>

      {!live ? (
        <Card title="3. Prueba en vivo">
          <p className="text-sm text-slate-600">Consulta directo a MercadoLibre (solo lectura) el estado de hasta 150 pedidos ML: primero los que siguen en ruta y luego los cerrados hoy en la app, y lo compara con el portal y con lo que marcó cada repartidor. Mide tiempos de respuesta y detecta bloqueos por intentos (429).</p>
          <ButtonLink href="/admin/mercadolibre/salud?probar=1" className="mt-3">Probar ahora</ButtonLink>
        </Card>
      ) : (
        <>
          <Card title={`3. Prueba en vivo · ${fecha(live.at)}`}>
            <div className="grid gap-3 text-sm sm:grid-cols-4">
              <div><p className="text-2xl font-bold">{live.answered}/{live.checked}</p><p className="text-slate-500">respondió ML</p></div>
              <div><p className={`text-2xl font-bold ${live.rateLimited ? "text-red-600" : ""}`}>{live.rateLimited}</p><p className="text-slate-500">bloqueos por intentos (429)</p></div>
              <div><p className="text-2xl font-bold">{live.p50} ms</p><p className="text-slate-500">respuesta típica (p95 {live.p95} ms)</p></div>
              <div><p className={`text-2xl font-bold ${live.verdicts.desfasado ? "text-red-600" : ""}`}>{live.verdicts.desfasado}</p><p className="text-slate-500">desfasados en el portal</p></div>
            </div>
            <p className="mt-2 text-xs text-slate-500">Respuestas de ML: {Object.entries(live.byHttp).map(([k, v]) => `${k}: ${v}`).join(" · ") || "—"}</p>
            <div className="mt-4 rounded-lg bg-slate-50 p-3 text-sm">
              <p className="font-semibold">Diagnóstico</p>
              <p className="mt-1">
                {live.checked === 0
                  ? "No hay pedidos ML de hoy para revisar."
                  : live.rateLimited > 0
                    ? "MercadoLibre nos está limitando por número de consultas (429): los estados pueden atrasarse."
                    : live.answered < live.checked * 0.9
                      ? "MercadoLibre está fallando o respondiendo intermitente: revisa los códigos de respuesta."
                      : live.verdicts.desfasado > 0
                        ? "La API de ML responde bien, pero el portal tenía estados atrasados: los avisos o la cola se retrasaron. Usa «Volver a sincronizar los desfasados»."
                        : "La API de ML responde bien y el portal coincide con ML. Lo que no está entregado en ML de verdad no se ha marcado entregado en la app Flex."}
              </p>
              {live.verdicts.desfasado > 0 && (
                <Link href="/admin/mercadolibre/salud?probar=1&resync=1" className="mt-2 inline-block text-brand hover:underline">Volver a sincronizar los desfasados →</Link>
              )}
            </div>
            <div className="mt-4 flex flex-wrap gap-2 text-xs">
              {Object.entries(live.verdicts).map(([k, v]) => (
                <span key={k} title={VERDICT[k].help}><Badge tone={VERDICT[k].tone}>{VERDICT[k].label}: {v}</Badge></span>
              ))}
            </div>
          </Card>

          <Card title="Por repartidor (pedidos ML de hoy revisados)">
            <Table head={["Repartidor", "Revisados", "Entregados en la app", "Entregados en ML", "Solo en la app", "Entregado en ML sin foto", "Siguen en ruta"]} empty={live.drivers.length ? undefined : "Sin datos"}>
              {live.drivers.map((d) => (
                <tr key={d.name}>
                  <Td>{d.name}</Td><Td>{d.total}</Td><Td>{d.appDelivered}</Td><Td>{d.mlDelivered}</Td>
                  <Td className={d.soloApp ? "font-semibold text-amber-700" : ""}>{d.soloApp}</Td>
                  <Td className={d.soloMl ? "font-semibold text-amber-700" : ""}>{d.soloMl}</Td><Td>{d.enRuta}</Td>
                </tr>
              ))}
            </Table>
          </Card>

          <Card title="Detalle">
            <Table head={["Pedido", "Repartidor", "En la app", "ML en el portal", "ML en vivo", "Resultado", "Tiempo"]} empty={live.rows.length ? undefined : "Sin pedidos"}>
              {live.rows.map((r) => (
                <tr key={r.orderId}>
                  <Td><Link href={`/admin/pedidos/${r.orderId}`} className="text-brand hover:underline">{r.code}</Link></Td>
                  <Td>{r.driver ?? "—"}</Td>
                  <Td>{STATUS_LABEL[r.ours as keyof typeof STATUS_LABEL] ?? r.ours}</Td>
                  <Td>{ml(r.stored)}</Td>
                  <Td>{r.live ? ml(r.live, r.liveSub) : `HTTP ${r.http || "—"}`}</Td>
                  <Td><span title={VERDICT[r.verdict].help}><Badge tone={VERDICT[r.verdict].tone}>{VERDICT[r.verdict].label}</Badge></span></Td>
                  <Td className="text-slate-500">{r.ms} ms</Td>
                </tr>
              ))}
            </Table>
          </Card>
        </>
      )}
    </div>
  );
}
