import type { Metadata } from "next";
import Link from "next/link";
import { buyerMessagePreview, getBuyerMessageSettings, getNotifySettings, NOTIFY_EVENTS, prisma, readHealth, type NotifyEvent } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import { fecha } from "@/lib/format";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, PageHeader, Table, Td } from "@/components/ui";
import { saveBuyerMessageAction, registerPhoneAction, registerTemplatesAction, retryAction, saveNotifyAction, subscribeWebhookAction, testSendAction } from "./actions";
import { phoneStatus, templateStatuses, webhookSubscriptions, webhookVerifyToken } from "@/lib/wa-templates";

export const metadata: Metadata = { title: "Avisos" };

const DAYS = ["", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
const daysAgo = (n: number) => new Date(Date.now() - n * 86400_000);
const STATUS = {
  PENDING: { label: "En cola", tone: "blue" as const },
  SENT: { label: "Enviado a Meta", tone: "blue" as const },
  DELIVERED: { label: "Entregado", tone: "green" as const },
  READ: { label: "Leído", tone: "green" as const },
  FAILED: { label: "Falló", tone: "red" as const },
  SKIPPED: { label: "Omitido", tone: "gray" as const },
};

/** Avisos por WhatsApp: qué se manda, a quién y bitácora [C11, F10, I04]. */
export default async function AvisosPage({ searchParams }: PageProps<"/admin/avisos">) {
  await requireUser(["ADMIN"]);
  const sp = await searchParams;
  const status = (["PENDING", "SENT", "DELIVERED", "READ", "FAILED", "SKIPPED"] as const).find((s) => s === sp.estado);
  const [settings, log, counts, health, bm, bmSent] = await Promise.all([
    getNotifySettings(prisma),
    prisma.notification.findMany({ where: status ? { status } : undefined, orderBy: { createdAt: "desc" }, take: 200 }),
    prisma.notification.groupBy({ by: ["status"], where: { createdAt: { gte: daysAgo(7) } }, _count: { _all: true } }),
    readHealth(prisma),
    getBuyerMessageSettings(prisma),
    prisma.orderEvent.groupBy({ by: ["note"], where: { type: "ml_buyer_message", recordedAt: { gte: daysAgo(7) } }, _count: { _all: true } }),
  ]);
  const bmOk = bmSent.filter((r) => r.note?.startsWith("Aviso al comprador en")).reduce((n, r) => n + r._count._all, 0);
  const bmNo = bmSent.reduce((n, r) => n + r._count._all, 0) - bmOk;
  const templates = await templateStatuses();
  // Las credenciales viven en el proceso en segundo plano; él reporta si las tiene.
  const configured = !!health.whatsapp && !health.whatsapp.detail?.startsWith("Sin credenciales");
  const c = (s: string) => counts.find((x) => x.status === s)?._count._all ?? 0;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader eyebrow="Gestión" title="Avisos por WhatsApp" actions={<Link href="/admin/avisos/invitar" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">Invitar al portal</Link>}>
        Mensajes automáticos al comprador y a la tienda. Últimos 7 días: {c("SENT") + c("DELIVERED") + c("READ")} enviados ({c("DELIVERED") + c("READ")} entregados) · {c("FAILED")} fallidos · {c("SKIPPED")} omitidos · {c("PENDING")} en cola.
      </PageHeader>
      {!configured && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          WhatsApp aún no está conectado: los avisos se registran como <strong>omitidos</strong> para que veas qué se habría enviado. Se activan al cargar las
          credenciales de la API de WhatsApp de Meta en el servidor y aprobar las plantillas de abajo.
        </div>
      )}

      <PhoneCard />

      <Card title="Aviso al comprador por Mercado Libre (Flex)">
        <p className="text-sm text-slate-600">
          Cuando el paquete Flex se asigna a ruta, Mercado Libre le manda al comprador, en el chat de su compra, la plantilla oficial de promesa de entrega:
          <span className="mt-1 block rounded-lg bg-slate-50 px-3 py-2 font-medium text-slate-800">«{buyerMessagePreview(bm)}»</span>
          Es texto de Mercado Libre (motivo DELIVERY_PROMISE): sin links ni datos de contacto, así que no cuenta como desviar al comprador. Una vez por venta.
          La hora de inicio se ajusta sola si ya es más tarde. Requiere que la app de ML tenga el permiso de «Comunicaciones post venta».
        </p>
        <p className="mt-2 text-xs text-slate-500">Últimos 7 días: {bmOk} enviados · {bmNo} no enviados (ver el historial del pedido).</p>
        <ActionForm action={saveBuyerMessageAction} submitLabel="Guardar" className="mt-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="enabled" defaultChecked={bm.enabled} className="h-4 w-4 accent-brand" /> Mandar el aviso
          </label>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <label>Entre las <input name="fromHour" type="number" min={7} max={22} defaultValue={bm.fromHour} className="w-16 rounded-lg border border-slate-300 px-2 py-1" /></label>
            <label>y las <input name="toHour" type="number" min={8} max={23} defaultValue={bm.toHour} className="w-16 rounded-lg border border-slate-300 px-2 py-1" /> hs</label>
            <label>
              Cuándo:{" "}
              <select name="trigger" defaultValue={bm.trigger} className="rounded-lg border border-slate-300 bg-white px-2 py-1">
                <option value="ASSIGNED">Al asignarse a un repartidor</option>
                <option value="OUT_FOR_DELIVERY">Al salir a ruta</option>
              </select>
            </label>
          </div>
        </ActionForm>
      </Card>

      <Card title="Plantillas en Meta">
        {!templates ? (
          <p className="text-sm text-slate-500">Para consultar y registrar las plantillas agrega <span className="font-mono">WHATSAPP_TOKEN</span> y <span className="font-mono">WHATSAPP_WABA_ID</span> en Coolify.</p>
        ) : (
          <div className="space-y-3">
            <ul className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
              {templates.map((t) => (
                <li key={t.template} className="rounded-lg border border-slate-200 px-3 py-2">
                  <p className="font-mono text-xs">{t.template}</p>
                  <p className="text-xs text-slate-500">{t.label}</p>
                  <p className={`text-xs font-medium ${t.status === "APPROVED" ? "text-emerald-700" : t.status === "REJECTED" ? "text-red-700" : "text-amber-700"}`}>
                    {t.status === "APPROVED" ? "Aprobada" : t.status === "PENDING" ? "En revisión" : t.status === "REJECTED" ? `Rechazada${t.reason ? `: ${t.reason}` : ""}` : t.status}
                  </p>
                </li>
              ))}
            </ul>
            <ActionForm action={registerTemplatesAction} submitLabel="Registrar las que falten">
              <p className="text-xs text-slate-500">Se mandan a revisión de Meta como categoría Utilidad en Español (MEX). Suelen aprobarse en minutos.</p>
            </ActionForm>
          </div>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-[420px_1fr]">
        <Card title="Qué avisos mandar">
          <ActionForm action={saveNotifyAction} submitLabel="Guardar">
            <ul className="space-y-3">
              {(Object.keys(NOTIFY_EVENTS) as NotifyEvent[]).map((k) => (
                <li key={k}>
                  <label className="flex items-start gap-2 text-sm">
                    <input type="checkbox" name={`on_${k}`} defaultChecked={settings.enabled[k]} className="mt-0.5 accent-brand" />
                    <span>
                      <span className="font-medium">{NOTIFY_EVENTS[k].label}</span> <Badge>{NOTIFY_EVENTS[k].audience}</Badge>
                      <span className="mt-0.5 block text-xs text-slate-500">{NOTIFY_EVENTS[k].text}</span>
                      <span className="block font-mono text-[11px] text-slate-400">Plantilla: {NOTIFY_EVENTS[k].template}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3 text-sm">
              <label>
                <span className="block text-slate-600">Recordatorio de pago</span>
                <select name="reminderWeekday" defaultValue={settings.reminderWeekday} className="mt-1 rounded-lg border border-slate-300 px-2 py-1.5">
                  {DAYS.slice(1).map((d, i) => <option key={d} value={i + 1}>{d}</option>)}
                </select>
              </label>
              <label>
                <span className="block text-slate-600">a las</span>
                <select name="reminderHour" defaultValue={settings.reminderHour} className="mt-1 rounded-lg border border-slate-300 px-2 py-1.5">
                  {Array.from({ length: 15 }, (_, i) => i + 7).map((h) => <option key={h} value={h}>{h}:00</option>)}
                </select>
              </label>
            </div>
          </ActionForm>
        </Card>

        <Card
          title="Bitácora"
          actions={
            <div className="flex gap-2 text-xs">
              <Link href="/admin/avisos" className={!status ? "font-semibold text-brand" : "text-slate-500"}>Todos</Link>
              {(Object.keys(STATUS) as (keyof typeof STATUS)[]).map((s) => (
                <Link key={s} href={`/admin/avisos?estado=${s}`} className={status === s ? "font-semibold text-brand" : "text-slate-500"}>{STATUS[s].label}</Link>
              ))}
            </div>
          }
        >
          <Table head={["Fecha", "Aviso", "Para", "Mensaje", "Estado", ""]} empty={log.length ? undefined : "Sin avisos todavía"}>
            {log.map((n) => (
              <tr key={n.id} className="align-top">
                <Td className="whitespace-nowrap text-xs text-slate-500">{fecha(n.createdAt)}</Td>
                <Td className="text-xs">{NOTIFY_EVENTS[n.event as NotifyEvent]?.label ?? n.event}</Td>
                <Td className="font-mono text-xs">{n.to}</Td>
                <Td className="max-w-md whitespace-normal text-xs text-slate-700">
                  {n.preview}
                  {n.orderId && <Link href={`/admin/pedidos/${n.orderId}`} className="ml-1 text-brand">ver pedido</Link>}
                </Td>
                <Td>
                  <Badge tone={STATUS[n.status].tone}>{STATUS[n.status].label}</Badge>
                  {n.error && <span className="mt-1 block max-w-[180px] whitespace-normal text-[11px] text-slate-500">{n.error}</span>}
                </Td>
                <Td>
                  {(n.status === "FAILED" || n.status === "SKIPPED") && (
                    <form action={retryAction.bind(null, n.id)}>
                      <button className="text-xs text-brand hover:underline">Reintentar</button>
                    </form>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>
    </div>
  );
}

const STATUS_ES: Record<string, string> = { CONNECTED: "Conectado", PENDING: "Pendiente de registrar", DISCONNECTED: "Desconectado", FLAGGED: "Marcado por Meta", RESTRICTED: "Restringido", BANNED: "Bloqueado" };

async function PhoneCard() {
  const [p, subs] = await Promise.all([phoneStatus(), webhookSubscriptions()]);
  return (
    <Card title="Número de WhatsApp">
      {!p ? (
        <p className="text-sm text-slate-500">Agrega <span className="font-mono">WHATSAPP_TOKEN</span> y <span className="font-mono">WHATSAPP_PHONE_ID</span> en Coolify.</p>
      ) : p.error ? (
        <p className="text-sm text-red-700">Meta respondió: {p.error}</p>
      ) : (
        <div className="space-y-4 text-sm">
          <p>
            <span className="font-semibold">{p.number}</span> · {p.name} · <span className={p.status === "CONNECTED" ? "text-emerald-700" : "text-amber-700"}>{STATUS_ES[p.status ?? ""] ?? p.status}</span>
            <span className="block text-xs text-slate-500">
              Nombre visible: {p.nameStatus ?? "—"} · Verificación: {p.verified ?? "—"} · Calidad: {p.quality ?? "—"} · Límite: {p.limit ?? "—"}
            </span>
          </p>
          {p.status !== "CONNECTED" && (
            <ActionForm action={registerPhoneAction} submitLabel="Registrar número en la API">
              <p className="text-xs text-slate-500">
                Último paso para que el número pueda mandar mensajes. Escribe un PIN de 6 dígitos para la verificación en dos pasos (guárdalo: Meta lo pide si
                el número se vuelve a registrar).
              </p>
              <input name="pin" inputMode="numeric" pattern={"[0-9]{6}"} maxLength={6} autoComplete="off" className="w-40 rounded-lg border border-slate-300 px-3 py-2 font-mono" aria-label="PIN de 6 dígitos" />
            </ActionForm>
          )}
          <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
            <p className="font-medium text-slate-800">
              Confirmación de entrega (webhook):{" "}
              {process.env.WHATSAPP_APP_SECRET ? <span className="text-emerald-700">App Secret configurado</span> : <span className="text-amber-700">falta WHATSAPP_APP_SECRET en Coolify</span>}
            </p>
            <p className="mt-1">En Meta → tu app → WhatsApp → Configuración → Webhook:</p>
            <p>URL de devolución de llamada: <span className="select-all font-mono">{(process.env.PUBLIC_URL || "https://portal.packatelas.mx").replace(/\/$/, "")}/api/whatsapp/webhook</span></p>
            <p>Token de verificación: <span className="select-all font-mono">{webhookVerifyToken() ?? "—"}</span></p>
            <p>Después suscribe el campo <span className="font-mono">messages</span>.</p>
            <p className="mt-2">
              Cuenta conectada a: {subs === null ? "—" : subs.length ? <span className="text-emerald-700">{subs.join(", ")}</span> : <span className="text-amber-700">ninguna app (no llegarán los estados)</span>}
            </p>
            {subs !== null && !subs.some((n) => /packatelas/i.test(n)) && (
              <ActionForm action={subscribeWebhookAction} submitLabel="Conectar la cuenta al webhook" className="mt-2">
                <span />
              </ActionForm>
            )}
          </div>
          <ActionForm action={testSendAction} submitLabel="Mandar prueba">
            <p className="text-xs text-slate-500">Manda la plantilla «Recolección asignada» a un celular (necesita estar aprobada).</p>
            <input name="to" inputMode="tel" placeholder="55 1234 5678" className="w-48 rounded-lg border border-slate-300 px-3 py-2" aria-label="Celular" />
          </ActionForm>
        </div>
      )}
    </Card>
  );
}
