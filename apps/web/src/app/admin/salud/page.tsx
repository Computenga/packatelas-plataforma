import type { Metadata } from "next";
import Link from "next/link";
import { driveConnection, driversWithoutLocation, mailConnection, prisma, readHealth, type HealthEntry } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import { fecha, hace } from "@/lib/format";
import { Badge, Card, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Salud operativa" };

type Level = "ok" | "warn" | "bad" | "off";
const TONE = { ok: "green", warn: "amber", bad: "red", off: "gray" } as const;
const LABEL = { ok: "Bien", warn: "Revisar", bad: "Falla", off: "Sin configurar" } as const;
const now = () => Date.now();

function fresh(h: HealthEntry | undefined, maxMin: number, t: number): Level {
  if (!h) return "off";
  if (t - new Date(h.at).getTime() > maxMin * 60_000) return "bad";
  return h.ok ? "ok" : "warn";
}

async function pingOsrm(): Promise<"ok" | "off" | "down"> {
  const base = process.env.OSRM_URL?.replace(/\/$/, "");
  if (!base) return "off";
  try {
    const r = await fetch(`${base}/nearest/v1/driving/-99.1332,19.4326`, { signal: AbortSignal.timeout(2000), cache: "no-store" });
    return r.ok ? "ok" : "down";
  } catch {
    return "down";
  }
}

/** Estado de integraciones y procesos [A20]. */
export default async function SaludPage({ searchParams }: PageProps<"/admin/salud">) {
  const sp = await searchParams;
  const driveMsg = typeof sp.drive === "string" ? sp.drive : null;
  const driveOk = typeof sp.driveok === "string" ? sp.driveok : null;
  await requireUser(["ADMIN"]);
  const t = now();
  const [health, ml, pendingSync, unidentified, failedNotices, lost, lastDeposit] = await Promise.all([
    readHealth(prisma),
    prisma.mlAccount.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.order.count({ where: { addressLine: "Pendiente de sincronizar con MercadoLibre", status: { notIn: ["CANCELLED", "DELIVERED"] } } }),
    prisma.payment.count({ where: { status: "UNIDENTIFIED" } }),
    prisma.notification.count({ where: { status: "FAILED", createdAt: { gte: new Date(t - 86400_000) } } }),
    driversWithoutLocation(prisma),
    prisma.payment.findFirst({ where: { source: "GMAIL" }, orderBy: { receivedAt: "desc" }, select: { receivedAt: true } }),
  ]);
  const [osrm, gdrive, mail] = await Promise.all([pingOsrm(), driveConnection(prisma), mailConnection(prisma)]);
  const mlCount = (s: string) => ml.find((m) => m.status === s)?._count._all ?? 0;
  const mlTotal = ml.reduce((a, m) => a + m._count._all, 0);
  const wa = health.whatsapp;

  const items: { name: string; level: Level; detail: React.ReactNode; href?: string }[] = [
    {
      name: "Proceso en segundo plano",
      level: health.worker ? fresh(health.worker, 5, t) : "bad",
      detail: health.worker ? `Último latido hace ${hace(new Date(health.worker.at), t)}` : "No ha reportado: revisa el servicio worker en Coolify",
    },
    {
      name: "Depósitos de Fondeadora (Gmail)",
      level: !health.gmail ? "off" : health.gmail.detail?.startsWith("Sin autorizar") ? "off" : fresh(health.gmail, 15, t),
      detail: (
        <>
          {health.gmail?.detail ?? "Aún sin datos"}
          {lastDeposit && <span className="block">Último depósito leído: {fecha(lastDeposit.receivedAt)}</span>}
          {unidentified > 0 && <span className="block text-amber-700">{unidentified} pago(s) sin identificar</span>}
        </>
      ),
      href: unidentified ? "/admin/cobros" : undefined,
    },
    {
      name: "MercadoLibre",
      level: mlTotal === 0 ? "off" : mlCount("TOKEN_EXPIRED") + mlCount("REVOKED") > 0 ? "warn" : "ok",
      detail: (
        <>
          {mlTotal} cuenta(s): {mlCount("ACTIVE")} conectadas, {mlCount("TOKEN_EXPIRED")} sin autorizar, {mlCount("REVOKED")} revocadas
          {health.mercadolibre?.detail && <span className="block">{health.mercadolibre.detail}</span>}
          {health.recuperados?.detail && <span className="block">Recuperados: {health.recuperados.detail}</span>}
          <a href="/admin/mercadolibre/mensajeria" className="block text-brand hover:underline">Mensajería Flex (reporte de envíos a ML) →</a>
          {pendingSync > 0 && <span className="block text-amber-700">{pendingSync} envío(s) sin datos de ML: su cuenta aún no autoriza a Packatelas</span>}
        </>
      ),
    },
    {
      name: "Avisos por WhatsApp",
      level: !wa || wa.detail?.startsWith("Sin credenciales") ? "off" : failedNotices ? "warn" : fresh(wa, 5, t),
      detail: (
        <>
          {wa?.detail ?? "Aún sin datos"}
          {failedNotices > 0 && <span className="block text-amber-700">{failedNotices} fallido(s) en 24 h</span>}
        </>
      ),
      href: "/admin/avisos",
    },
    {
      name: "Tareas programadas",
      level: health.tareas ? fresh(health.tareas, 90, t) : "off",
      detail: health.tareas ? `${health.tareas.detail} · hace ${hace(new Date(health.tareas.at), t)}` : "Aún sin datos",
    },
    {
      name: "Buscador de direcciones",
      level: process.env.GOOGLE_MAPS_API_KEY ? "ok" : "warn",
      detail: process.env.GOOGLE_MAPS_API_KEY ? "Google Places configurado" : "Usando OpenStreetMap (sin llave de Google)",
    },
    {
      name: "Rutas con tiempos reales",
      level: osrm === "ok" ? "ok" : osrm === "off" ? "off" : "warn",
      detail: osrm === "ok" ? "OSRM respondiendo (mapa CDMX y Edomex)" : osrm === "off" ? "Orden en línea recta hasta montar OSRM" : "OSRM aún preparando el mapa o sin responder; mientras, orden en línea recta",
    },
    {
      name: "Tráfico en vivo (TomTom)",
      level: process.env.TOMTOM_API_KEY ? "ok" : "off",
      detail: process.env.TOMTOM_API_KEY
        ? "La ruta del repartidor se afina con tráfico en vivo (modo moto) y muestra minutos estimados a cada parada"
        : "Sin TOMTOM_API_KEY: la ruta usa OSRM (sin tráfico)",
    },
    {
      name: "Respaldos de la base",
      level: !health.respaldos ? "off" : health.respaldos.ok ? fresh(health.respaldos, 90, t) : /falta (DRIVE_REFRESH_TOKEN|conectar Google Drive)/.test(health.respaldos.detail ?? "") ? "warn" : "bad",
      detail: (
        <>
          {health.respaldos?.detail ?? "Aún sin datos: el worker revisa cada 30 min"}
          {health.respaldos && !health.respaldos.detail?.startsWith("Aún no hay") && (
            <a href="/admin/salud/respaldo" className="mt-1 block text-brand hover:underline">Descargar el más reciente</a>
          )}
          {gdrive.connected ? (
            <span className="mt-1 block text-xs text-slate-500">
              Drive: {gdrive.email}
              {gdrive.at ? ` · desde ${fecha(new Date(gdrive.at))}` : ""} ·{" "}
              <a href="/api/drive/conectar" className="text-brand hover:underline">cambiar cuenta</a>
            </span>
          ) : (
            <a href="/api/drive/conectar" className="mt-2 inline-block rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white">Conectar Google Drive</a>
          )}
        </>
      ),
    },
    {
      name: "Correo de envío (restablecer contraseñas)",
      level: mail.connected ? "ok" : "warn",
      detail: mail.connected ? (
        <>
          Sale desde {mail.email} ·{" "}
          <a href="/api/correo/conectar" className="text-brand hover:underline">cambiar cuenta</a>
        </>
      ) : (
        <>
          Sin conectar: los clientes no pueden restablecer su contraseña por correo.
          <a href="/api/correo/conectar" className="mt-2 block w-fit rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white">Conectar correo</a>
        </>
      ),
    },
    {
      name: "Repartidores con ubicación",
      level: lost.length ? "warn" : "ok",
      detail: lost.length ? `${lost.length} en turno sin ubicación: ${lost.map((d) => d.user.name).join(", ")}` : "Todos los que están en turno reportan",
      href: lost.length ? "/admin/despacho" : undefined,
    },
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader eyebrow="Gestión" title="Salud operativa">Estado de procesos e integraciones. Se actualiza al recargar.</PageHeader>
      {driveOk && <p className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{driveOk}</p>}
      {driveMsg && <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{driveMsg}</p>}
      <div className="grid gap-4 md:grid-cols-2">
        {items.map((i) => (
          <Card key={i.name} title={i.name} actions={<Badge tone={TONE[i.level]}>{LABEL[i.level]}</Badge>}>
            <div className="text-sm text-slate-600">{i.detail}</div>
            {i.href && <Link href={i.href} className="mt-2 inline-block text-sm text-brand hover:underline">Ver →</Link>}
          </Card>
        ))}
      </div>
    </div>
  );
}
