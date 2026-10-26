import type { Metadata } from "next";
import Link from "next/link";
import { driversWithoutLocation, prisma, readHealth, type HealthEntry } from "@packatelas/db";
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

/** Estado de integraciones y procesos [A20]. */
export default async function SaludPage() {
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
      level: process.env.OSRM_URL ? "ok" : "off",
      detail: process.env.OSRM_URL ? "OSRM configurado" : "Orden en línea recta hasta montar OSRM",
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
