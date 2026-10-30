import type { Metadata } from "next";
import Link from "next/link";
import { cutoverPreview, CUTOVER_CONFIRM, getCutover, OPENING_BALANCE_TAG, prisma, readHealth } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import { fecha } from "@/lib/format";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, PageHeader } from "@/components/ui";
import { cutoverAction } from "./actions";

export const metadata: Metadata = { title: "Arranque" };

const now = () => Date.now();
const backupHours = (d?: string) => Number(/hace (\d+) h/.exec(d ?? "")?.[1] ?? Infinity);

type Check = { label: string; ok: boolean; detail: string; href?: string };

/** Guía y verificación del día del cambio del sistema anterior a esta plataforma. */
export default async function ArranquePage() {
  await requireUser(["ADMIN"]);
  const [state, preview, health, admins, adminsNo2fa, drivers, openings, unidentified] = await Promise.all([
    getCutover(prisma),
    cutoverPreview(prisma),
    readHealth(prisma),
    prisma.user.count({ where: { role: "ADMIN", active: true } }),
    prisma.user.count({ where: { role: "ADMIN", active: true, totpSecret: null } }),
    prisma.driver.count({ where: { active: true } }),
    prisma.ledgerEntry.aggregate({ where: { description: OPENING_BALANCE_TAG }, _sum: { amount: true }, _count: true }),
    prisma.payment.count({ where: { status: "UNIDENTIFIED" } }),
  ]);
  const t = now();
  const fresh = (k: string, h: number) => !!health[k]?.ok && t - new Date(health[k].at).getTime() < h * 3600_000;
  const url = process.env.PUBLIC_URL ?? "";
  const checks: Check[] = [
    { label: "Respaldo de hoy", ok: backupHours(health.respaldos?.detail) < 30, detail: health.respaldos?.detail ?? "Sin datos", href: "/admin/salud" },
    { label: "Administradores con verificación en dos pasos", ok: adminsNo2fa === 0, detail: `${admins - adminsNo2fa} de ${admins}`, href: "/admin/usuarios" },
    { label: "Clientes y cuentas de MercadoLibre", ok: preview.conservar.clientes > 0, detail: `${preview.conservar.clientes} clientes · ${preview.conservar.cuentasML} cuentas ML`, href: "/admin/clientes" },
    { label: "Repartidores con usuario", ok: drivers > 0, detail: `${drivers} activos`, href: "/admin/repartidores" },
    { label: "Personal", ok: preview.conservar.personal > 0, detail: `${preview.conservar.personal} empleados`, href: "/admin/personal" },
    { label: "Depósitos de Fondeadora (Gmail)", ok: fresh("gmail", 1), detail: health.gmail?.detail ?? "Sin datos", href: "/admin/salud" },
    { label: "Avisos por WhatsApp", ok: !!process.env.WHATSAPP_TOKEN, detail: process.env.WHATSAPP_TOKEN ? "Configurado" : "Sin configurar (se puede arrancar sin él)", href: "/admin/avisos" },
    { label: "Dominio definitivo", ok: url.includes("admin.packatelas.mx"), detail: url || "PUBLIC_URL sin definir" },
    { label: "Saldos iniciales cargados", ok: openings._count > 0, detail: openings._count ? `${openings._count} clientes · total $${Number(openings._sum.amount ?? 0).toLocaleString("es-MX", { minimumFractionDigits: 2 })}` : "Aún no", href: "/admin/clientes/importar" },
    { label: "Pagos sin identificar", ok: unidentified === 0, detail: `${unidentified} por asignar`, href: "/admin/cobros" },
  ];
  const b = preview.borrar;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader eyebrow="Gestión" title="Arranque">
        Pasos del día en que se deja el sistema anterior y Shipday. {state ? <>El arranque se hizo el <b>{fecha(new Date(state.at))}</b>.</> : "Todavía no se hace el arranque."}
      </PageHeader>

      <Card title="Verificación">
        <ul className="divide-y divide-slate-100 text-sm">
          {checks.map((c) => (
            <li key={c.label} className="flex items-start justify-between gap-3 py-2">
              <span>
                {c.href ? <Link href={c.href} className="font-medium hover:underline">{c.label}</Link> : <span className="font-medium">{c.label}</span>}
                <span className="block text-xs text-slate-500">{c.detail}</span>
              </span>
              <Badge tone={c.ok ? "green" : "amber"}>{c.ok ? "Listo" : "Pendiente"}</Badge>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Guía del día del cambio">
        <div className="space-y-4 text-sm text-slate-700">
          <div>
            <p className="font-medium">Un día antes</p>
            <ol className="mt-1 list-decimal space-y-1 pl-5">
              <li>Repartidores: instalar la app (Android: nuevo.packatelas.mx/descargar), entrar con su usuario e iniciar y terminar un turno de prueba.</li>
              <li>Operador y despachador: repasar su sección del manual y escanear un paquete de prueba.</li>
              <li>Avisar a los clientes de su usuario del portal y de la nueva referencia de pago (Estado de cuenta).</li>
            </ol>
          </div>
          <div>
            <p className="font-medium">La noche del cambio (después del último corte)</p>
            <ol className="mt-1 list-decimal space-y-1 pl-5">
              <li>En el sistema anterior: último corte del día; desde ese momento no registrar nada ahí.</li>
              <li>Salud operativa → <b>Descargar el respaldo más reciente</b> y guardarlo.</li>
              <li>Aquí abajo: <b>Borrar los datos de prueba</b> (una sola vez).</li>
              <li>Exportar del sistema anterior la lista de clientes con <b>ID y Saldo</b> (positivo = el cliente debe) y cargarla en <Link href="/admin/clientes/importar" className="text-brand hover:underline">Clientes → Importar</Link>. Comparar el total que muestra la Verificación con el del sistema anterior.</li>
              <li>Revisar Pagos sin identificar.</li>
              <li>Dominio (lo hace soporte): en GoDaddy, registro A de <code>admin</code> → 74.208.245.157; en Coolify agregar <code>https://admin.packatelas.mx</code> sin quitar <code>nuevo.packatelas.mx</code>, y cambiar <code>PUBLIC_URL</code>. Volver a desplegar.</li>
              <li>MercadoLibre (portal de desarrolladores): URL de redirección <code>https://admin.packatelas.mx/api/ml/callback</code> y notificaciones <code>https://admin.packatelas.mx/api/ml/notificaciones</code>.</li>
              <li>La app Android sigue funcionando con los dos dominios; la nueva versión con admin.packatelas.mx puede salir después.</li>
            </ol>
          </div>
          <div>
            <p className="font-medium">El primer día</p>
            <ol className="mt-1 list-decimal space-y-1 pl-5">
              <li>Operador escanea todo lo que llega en Escanear; las cuentas sin ligar se ligan ahí mismo.</li>
              <li>Despacho asigna desde el tablero; revisar en Salud operativa que todos los repartidores en turno reporten ubicación.</li>
              <li>Al final del día: Devoluciones → recibir lo que regresó; revisar Cobros.</li>
              <li>Shipday y el admin anterior se quedan solo para consulta durante un mes.</li>
            </ol>
          </div>
        </div>
      </Card>

      <Card title="Borrar los datos de prueba" actions={state ? <Badge tone="green">Hecho</Badge> : <Badge tone="amber">Una sola vez</Badge>}>
        {state ? (
          <p className="text-sm text-slate-600">Ya se hizo el {fecha(new Date(state.at))}. Esta opción ya no está disponible para no borrar operación real.</p>
        ) : (
          <>
            <p className="text-sm text-slate-600">
              Se borran <b>{b.envios}</b> envíos (con sus <b>{b.evidencias}</b> fotos), <b>{b.movimientos}</b> movimientos de saldo, <b>{b.recolecciones}</b> recolecciones, <b>{b.ubicaciones}</b> ubicaciones,
              {" "}<b>{b.avisos}</b> avisos y la numeración PK vuelve a empezar en PK-000001. Los <b>{preview.archivar.pagos}</b> depósitos recibidos se conservan como “anteriores al arranque” (ya están en el saldo del sistema anterior).
            </p>
            <p className="mt-2 text-sm text-slate-600">
              Se conservan {preview.conservar.clientes} clientes con sus sucursales y tarifas, {preview.conservar.cuentasML} cuentas de MercadoLibre, {preview.conservar.usuarios} usuarios, {preview.conservar.personal} empleados, la flotilla, la nómina y el historial migrado del sistema anterior ({preview.conservar.historialEnvios} envíos y {preview.conservar.historialPagos} pagos).
            </p>
            <div className="mt-4">
              <ActionForm action={cutoverAction} submitLabel="Borrar datos de prueba">
                <label className="block text-sm">Para confirmar escribe <b>{CUTOVER_CONFIRM}</b>
                  <input name="confirm" required autoComplete="off" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono" />
                </label>
              </ActionForm>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
