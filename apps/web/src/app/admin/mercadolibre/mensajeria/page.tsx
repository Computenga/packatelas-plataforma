import type { Metadata } from "next";
import { courierAccount, courierAuthUrl, getCourierSettings, prisma } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import { fecha } from "@/lib/format";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, PageHeader } from "@/components/ui";
import { saveCourierAction, testCourierAction } from "./actions";

export const metadata: Metadata = { title: "Mensajería Flex" };

export default async function MensajeriaPage({ searchParams }: PageProps<"/admin/mercadolibre/mensajeria">) {
  const user = await requireUser(["ADMIN"]);
  const sp = await searchParams;
  const flexSamples = ((await prisma.setting.findUnique({ where: { key: "ml.notif.flex.samples" } }))?.value as { at: string; topic: string; resource: string; user_id: number | null }[] | undefined) ?? [];
  const [s, acc, reports, candidates, pending] = await Promise.all([
    getCourierSettings(prisma),
    courierAccount(prisma),
    prisma.mlCourierReport.findMany({ orderBy: { updatedAt: "desc" }, take: 50 }),
    prisma.mlFlexShipment.findMany({
      where: { logisticType: "self_service", orderId: null, mlStatus: { in: ["ready_to_ship", "shipped"] } },
      orderBy: { mlCreatedAt: "desc" },
      take: 50,
      include: { client: { select: { name: true } }, mlAccount: { select: { nickname: true } } },
    }),
    prisma.mlCourierReport.count({ where: { status: "PENDING" } }),
  ]);
  const authUrl = courierAuthUrl(user.id);
  const okMsg = typeof sp.ok === "string" ? sp.ok : null;
  const errMsg = typeof sp.error === "string" ? sp.error : null;
  const mismatch = acc && s.expectedUserId && acc.userId !== s.expectedUserId;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader eyebrow="MercadoLibre" title="Mensajería Flex">
        Packatelas reporta a MercadoLibre los envíos Flex que lleva (modelo nuevo de integración de mensajerías).
      </PageHeader>
      {okMsg && <p className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">Cuenta autorizada: {okMsg}</p>}
      {errMsg && <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800">{errMsg}</p>}

      <Card title="1. Cuenta de MercadoLibre de la mensajería">
        {acc ? (
          <p className="text-sm">
            {acc.nickname} · ID {acc.userId}{acc.email && ` · ${acc.email}`}{" "}
            <Badge tone={acc.status === "ACTIVE" ? "green" : "red"}>{acc.status === "ACTIVE" ? "autorizada" : acc.status === "REVOKED" ? "revocada" : "sin renovar"}</Badge>
            <span className="block text-xs text-slate-500">Autorizada el {fecha(new Date(acc.connectedAt))}</span>
            {mismatch && <span className="block text-red-700">No coincide con el ID esperado ({s.expectedUserId}).</span>}
          </p>
        ) : (
          <p className="text-sm text-slate-600">Aún no se autoriza.</p>
        )}
        {authUrl ? (
          <div className="mt-3 text-sm">
            <p className="text-slate-700">
              Abre el enlace con la sesión de MercadoLibre de la cuenta de la mensajería{s.expectedUserId && <> (ID <strong>{s.expectedUserId}</strong>)</>} —la misma con la que se registraron como Mensajería Flex— y da clic en «Autorizar». Si el navegador tiene abierta otra cuenta de ML, ciérrala primero.
            </p>
            <a href={authUrl} className="mt-2 inline-block rounded-lg bg-brand px-4 py-2 font-medium text-white">{acc ? "Volver a autorizar" : "Autorizar cuenta de mensajería"}</a>
            <p className="mt-1 text-xs text-slate-500">El enlace vale 2 días.</p>
          </div>
        ) : (
          <p className="mt-2 text-sm text-red-700">Falta configurar la app de MercadoLibre (ML_CLIENT_ID, ML_CLIENT_SECRET, PUBLIC_URL).</p>
        )}
      </Card>

      <Card title="2. Prueba con un envío">
        <p className="mb-3 text-sm text-slate-600">Reporta <strong>un solo envío</strong> a MercadoLibre aunque el envío automático esté apagado. Úsalo con un envío de Recuperados.</p>
        <ActionForm action={testCourierAction} submitLabel="Reportar este envío a MercadoLibre">
          <select name="shipmentId" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" defaultValue="">
            <option value="" disabled>Elige un envío Flex de Recuperados…</option>
            {candidates.map((c) => (
              <option key={c.id} value={c.shipmentId.toString()}>
                {c.shipmentId.toString()} · {c.client.name} · {c.mlAccount.nickname} · {c.mlStatus}
              </option>
            ))}
          </select>
        </ActionForm>
      </Card>

      <Card title="3. Envío automático">
        <p className="mb-3 text-sm text-slate-600">
          Encendido: cada envío Flex que escanea la bodega o un repartidor se reporta a MercadoLibre en segundo plano (con reintentos). Apagado: no se encola ni se manda nada.
          {pending > 0 && <> Hay {pending} reporte(s) pendiente(s).</>}
        </p>
        <ActionForm action={saveCourierAction} submitLabel="Guardar">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="enabled" defaultChecked={s.enabled} /> Reportar automáticamente a MercadoLibre
            <Badge tone={s.enabled ? "green" : "gray"}>{s.enabled ? "encendido" : "apagado"}</Badge>
          </label>
          <label className="block text-sm">
            Para encender, escribe <strong>ENVIAR A MERCADOLIBRE</strong>
            <input name="confirm" autoComplete="off" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
          </label>
          <label className="block text-sm sm:w-1/2">
            ID de la cuenta de la mensajería en ML
            <input name="expectedUserId" defaultValue={s.expectedUserId ?? ""} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
          </label>
        </ActionForm>
      </Card>

      <Card title="Avisos de Flex recibidos de MercadoLibre">
        {flexSamples.length === 0 ? (
          <p className="text-sm text-slate-500">Aún no llega ninguno. Llegan cuando un repartidor escanea en la app Flex (si el tópico está activo en la app de ML).</p>
        ) : (
          <ul className="space-y-1 font-mono text-xs text-slate-600">
            {flexSamples.map((x, i) => (
              <li key={i}>{fecha(new Date(x.at))} · {x.topic} · {x.resource}{x.user_id ? ` · usuario ${x.user_id}` : ""}</li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Reportes recientes">
        {reports.length === 0 ? (
          <p className="text-sm text-slate-500">Aún no se ha reportado nada.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-slate-500">
              <tr><th className="py-1">Fecha</th><th>Envío</th><th>Origen</th><th>Estado</th><th>Respuesta de ML</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {reports.map((r) => (
                <tr key={r.id} className="align-top">
                  <td className="py-1">{fecha(r.sentAt ?? r.updatedAt)}</td>
                  <td className="font-mono text-xs">{r.shipmentId.toString()}</td>
                  <td>{r.source}</td>
                  <td><Badge tone={r.status === "SENT" ? "green" : r.status === "FAILED" ? "red" : "amber"}>{r.status === "SENT" ? "enviado" : r.status === "FAILED" ? "falló" : "pendiente"}</Badge>{r.httpStatus && <span className="ml-1 text-xs text-slate-500">HTTP {r.httpStatus}</span>}</td>
                  <td className="max-w-md break-all font-mono text-xs text-slate-600">{r.response || r.lastError || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
