import type { Metadata } from "next";
import Link from "next/link";
import QRCode from "qrcode";
import { DEMO_PUBLIC_ID, prisma } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import { fecha, STATUS_LABEL } from "@/lib/format";
import { publicTrackingUrl } from "@/lib/tracking";
import { ActionForm } from "@/components/action-form";
import { AutoRefresh } from "@/components/auto-refresh";
import { Badge, Card, PageHeader, Table, Td } from "@/components/ui";
import { createDemoAction } from "./actions";

export const metadata: Metadata = { title: "Depurar pedido" };
export const dynamic = "force-dynamic";

const qr = (text: string) => QRCode.toDataURL(text, { margin: 1, width: 280, color: { dark: "#0f1e4a", light: "#ffffff" } });

/** Modo depuración: todo lo que le pasa a un pedido, en vivo (se actualiza cada 5 s). */
export default async function DepurarPage({ searchParams }: PageProps<"/admin/depurar">) {
  await requireUser(["ADMIN"]);
  const sp = await searchParams;
  const code = typeof sp.code === "string" ? sp.code.trim().toUpperCase() : "";
  const order = code
    ? await prisma.order.findUnique({
        where: { code },
        include: {
          client: { select: { name: true, publicId: true } },
          driver: { select: { lastLat: true, lastLng: true, lastLocationAt: true, onDuty: true, user: { select: { name: true } } } },
          events: { orderBy: { recordedAt: "asc" }, include: { actor: { select: { name: true } } } },
          custodies: { orderBy: { startedAt: "asc" }, include: { driver: { select: { user: { select: { name: true } } } } } },
          evidence: true,
          pickup: { select: { id: true, status: true, collectedCount: true } },
          flexShipment: { select: { shipmentId: true } },
        },
      })
    : null;
  const [notices, demos] = await Promise.all([
    order ? prisma.notification.findMany({ where: { orderId: order.id }, orderBy: { createdAt: "asc" } }) : [],
    prisma.order.findMany({ where: { client: { publicId: DEMO_PUBLIC_ID } }, orderBy: { createdAt: "desc" }, take: 10, select: { code: true, status: true, kind: true, createdAt: true } }),
  ]);
  const img = order ? await qr(order.code) : null;
  const track = order ? publicTrackingUrl(order.id) : null;

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <AutoRefresh seconds={5} />
      <PageHeader eyebrow="Modo depuración" title={order ? order.code : "Depurar pedido"}>
        Se actualiza cada 5 segundos. Muestra estados, historial completo, inventario, avisos de WhatsApp y evidencias de un pedido.
      </PageHeader>

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Ver un pedido">
          <form className="flex gap-2">
            <input name="code" defaultValue={code} placeholder="PK-000123, RC-000123 o ML-…" className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            <button className="rounded-lg bg-brand px-4 text-sm text-white">Ver</button>
          </form>
          {demos.length > 0 && (
            <p className="mt-3 flex flex-wrap gap-2 text-xs">
              Demos:{" "}
              {demos.map((d) => (
                <Link key={d.code} href={`/admin/depurar?code=${d.code}`} className="font-mono text-brand underline">
                  {d.code} ({STATUS_LABEL[d.status]})
                </Link>
              ))}
            </p>
          )}
        </Card>
        <Card title="Crear flujo de prueba">
          <ActionForm action={createDemoAction} submitLabel="Crear envío y recolección demo">
            <p className="text-xs text-slate-500">
              Crea (o reutiliza) el cliente «DEMO Packatelas» sin cobro, un envío PK-… a Insurgentes Sur 1235 y una recolección RC-… de hoy en Reforma 222. Los
              avisos de WhatsApp llegan a este celular.
            </p>
            <input name="phone" inputMode="tel" required placeholder="Tu celular (10 dígitos)" className="w-56 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          </ActionForm>
        </Card>
      </div>

      {code && !order && <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">No existe el pedido {code}.</p>}

      {order && (
        <>
          <div className="grid gap-4 md:grid-cols-[300px_1fr]">
            <Card title="QR para escanear">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {img && <img src={img} alt={`QR ${order.code}`} width={260} height={260} className="mx-auto" />}
              <p className="mt-2 text-center font-mono text-lg font-bold">{order.code}</p>
            </Card>
            <Card title="Estado actual">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <dt className="text-slate-500">Tipo</dt><dd>{order.kind === "PICKUP" ? "Recolección" : "Entrega"}</dd>
                <dt className="text-slate-500">Estado</dt><dd><Badge tone="blue">{STATUS_LABEL[order.status]}</Badge> <span className="font-mono text-xs">{order.status}</span></dd>
                <dt className="text-slate-500">Cliente</dt><dd>{order.client.name}</dd>
                <dt className="text-slate-500">Repartidor</dt>
                <dd>
                  {order.driver ? `${order.driver.user.name} · ${order.driver.onDuty ? "en turno" : "fuera de turno"}` : "—"}
                  {order.driver?.lastLocationAt && <span className="block text-xs text-slate-500">Última ubicación {fecha(order.driver.lastLocationAt)} ({order.driver.lastLat?.toFixed(4)}, {order.driver.lastLng?.toFixed(4)})</span>}
                </dd>
                <dt className="text-slate-500">Destino</dt><dd>{order.addressLine}{order.lat != null ? ` (${order.lat.toFixed(4)}, ${order.lng?.toFixed(4)})` : " · sin pin"}</dd>
                <dt className="text-slate-500">Teléfono avisos</dt><dd className="font-mono">{order.recipientPhone ?? "—"}</dd>
                <dt className="text-slate-500">ML</dt><dd>{order.mlStatus ?? "—"}{order.mlSubstatus ? ` · ${order.mlSubstatus}` : ""}</dd>
                <dt className="text-slate-500">Intentos</dt><dd>{order.attempts}</dd>
                {order.pickup && (<><dt className="text-slate-500">Recolección</dt><dd>{order.pickup.status}{order.pickup.collectedCount != null ? ` · ${order.pickup.collectedCount} paquete(s)` : ""}</dd></>)}
                <dt className="text-slate-500">Rastreo</dt>
                <dd className="break-all"><a href={track!} target="_blank" rel="noreferrer" className="text-brand underline">{track}</a></dd>
                <dt className="text-slate-500">Detalle</dt><dd><Link href={`/admin/pedidos/${order.id}`} className="text-brand underline">Abrir pedido</Link></dd>
              </dl>
            </Card>
          </div>

          <Card title={`Historial completo (${order.events.length})`}>
            <Table head={["Registrado", "Hora real", "Evento", "Estado", "Origen", "Quién", "Nota"]}>
              {order.events.map((e) => (
                <tr key={e.id} className="align-top">
                  <Td className="text-xs">{fecha(e.recordedAt)}</Td>
                  <Td className="text-xs text-slate-500">{fecha(e.occurredAt)}</Td>
                  <Td className="font-mono text-xs">{e.type}</Td>
                  <Td className="text-xs">{e.toStatus ? `${e.fromStatus ?? "—"} → ${e.toStatus}` : ""}</Td>
                  <Td className="text-xs">{e.source}</Td>
                  <Td className="text-xs">{e.actor?.name ?? ""}</Td>
                  <Td className="max-w-md whitespace-normal text-xs">
                    {e.note}
                    {e.lat != null && <span className="block text-slate-400">({e.lat.toFixed(4)}, {e.lng?.toFixed(4)})</span>}
                  </Td>
                </tr>
              ))}
            </Table>
          </Card>

          <div className="grid gap-4 md:grid-cols-2">
            <Card title={`Inventario (${order.custodies.length})`}>
              {order.custodies.length === 0 ? (
                <p className="text-sm text-slate-500">{order.kind === "PICKUP" ? "Las recolecciones no entran al inventario." : "Aún no entra al inventario de ningún repartidor."}</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {order.custodies.map((c) => (
                    <li key={c.id} className="rounded-lg border border-slate-200 px-3 py-2">
                      <span className="font-medium">{c.driver.user.name}</span> · {c.how}
                      <span className="block text-xs text-slate-500">
                        Entró {fecha(c.startedAt)} · {c.endedAt ? `salió ${fecha(c.endedAt)} (${c.endReason})` : "SIGUE EN SU INVENTARIO"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card title={`Evidencias (${order.evidence.length})`}>
              {order.evidence.length === 0 ? (
                <p className="text-sm text-slate-500">Sin fotos todavía.</p>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  {order.evidence.map((ev) => (
                    <a key={ev.id} href={`/api/evidence/${ev.storageKey}`} target="_blank" rel="noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`/api/evidence/${ev.storageKey}`} alt="Evidencia" className="aspect-square w-full rounded-lg object-cover" />
                    </a>
                  ))}
                </div>
              )}
            </Card>
          </div>

          <Card title={`Avisos de WhatsApp (${notices.length})`}>
            {notices.length === 0 ? (
              <p className="text-sm text-slate-500">Ningún aviso para este pedido todavía.</p>
            ) : (
              <Table head={["Creado", "Aviso", "Para", "Estado", "Enviado", "Último estado", "Detalle"]}>
                {notices.map((n) => (
                  <tr key={n.id} className="align-top">
                    <Td className="text-xs">{fecha(n.createdAt)}</Td>
                    <Td className="font-mono text-xs">{n.template}</Td>
                    <Td className="font-mono text-xs">{n.to}</Td>
                    <Td><Badge tone={n.status === "FAILED" ? "red" : n.status === "DELIVERED" || n.status === "READ" ? "green" : n.status === "SKIPPED" ? "gray" : "blue"}>{n.status}</Badge></Td>
                    <Td className="text-xs">{fecha(n.sentAt)}</Td>
                    <Td className="text-xs">{fecha(n.statusAt)}</Td>
                    <Td className="max-w-xs whitespace-normal text-xs">{n.error ?? n.preview}</Td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
