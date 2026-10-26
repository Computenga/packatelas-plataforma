import { decryptSecret, prisma } from "@packatelas/db";
import { ActionForm } from "@/components/action-form";
import { Badge, Button, Card, Field, Select } from "@/components/ui";
import { fecha } from "@/lib/format";
import { Secret } from "./key-form";
import { connectStoreAction, removeStoreAction, toggleStoreAction } from "./actions";

/** Tiendas WooCommerce y Shopify conectadas por webhook [I06]. */
export async function Stores({ clientId, base }: { clientId: string; base: string }) {
  const [stores, branches] = await Promise.all([
    prisma.storeConnector.findMany({ where: { clientId }, orderBy: { createdAt: "asc" } }),
    prisma.branch.findMany({ where: { clientId, active: true }, orderBy: { createdAt: "asc" }, select: { id: true, name: true } }),
  ]);
  return (
    <Card title="Tiendas en línea (WooCommerce y Shopify)">
      <p className="mb-3 text-sm text-slate-600">
        Los pedidos pagados de tu tienda con dirección en CDMX o Estado de México se registran solos como envíos, con tu tarifa. Los de otros estados o para recoger en tienda se ignoran.
      </p>
      <ActionForm action={connectStoreAction} submitLabel="Agregar tienda" resetOnSuccess>
        <div className="grid gap-3 sm:grid-cols-2">
          <Select name="platform" label="Plataforma" defaultValue="WOOCOMMERCE">
            <option value="WOOCOMMERCE">WooCommerce</option>
            <option value="SHOPIFY">Shopify</option>
          </Select>
          <Field name="name" label="Nombre" placeholder="Mi tienda" maxLength={60} />
          {branches.length > 1 && (
            <Select name="branchId" label="Recolectar en la sucursal" defaultValue="">
              <option value="">La principal</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
          )}
          <Field name="secret" label="Solo Shopify: clave de firma de webhooks" placeholder="La muestra Shopify en Notificaciones → Webhooks" autoComplete="off" />
        </div>
      </ActionForm>
      {stores.length > 0 && (
        <ul className="mt-5 space-y-4">
          {stores.map((s) => {
            const url = `${base}/api/tiendas/${s.id}`;
            return (
              <li key={s.id} className="rounded-lg border border-slate-200 p-4 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">{s.name} <Badge tone={s.active ? "green" : "gray"}>{s.platform === "SHOPIFY" ? "Shopify" : "WooCommerce"} · {s.active ? "activa" : "pausada"}</Badge></p>
                  <div className="flex gap-2">
                    <form action={toggleStoreAction.bind(null, s.id)}><Button variant="secondary">{s.active ? "Pausar" : "Reanudar"}</Button></form>
                    <form action={removeStoreAction.bind(null, s.id)}><Button variant="ghost">Quitar</Button></form>
                  </div>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {s.received} aviso(s) recibidos · {s.created} envío(s) creados{s.lastAt ? ` · último ${fecha(s.lastAt)}: ${s.lastResult}` : " · aún no llega ningún pedido"}
                </p>
                <div className="mt-3 space-y-1">
                  <p>URL de entrega: <code className="break-all rounded bg-slate-100 px-2 py-1 font-mono text-xs">{url}</code></p>
                  {s.platform === "WOOCOMMERCE" ? (
                    <>
                      <p>Secreto: <Secret value={decryptSecret(s.secret)} /></p>
                      <p className="text-xs text-slate-600">
                        En WordPress: WooCommerce → Ajustes → Avanzado → Webhooks → Añadir webhook. Estado: Activo · Tema: <b>Pedido actualizado</b> · URL de entrega: la de arriba · Secreto: el de arriba · Versión de API: la más reciente. Guarda. Cada pedido se registra al pasar a “Procesando”.
                      </p>
                    </>
                  ) : (
                    <p className="text-xs text-slate-600">
                      En Shopify: Configuración → Notificaciones → Webhooks → Crear webhook. Evento: <b>Pago del pedido</b> · Formato: JSON · URL: la de arriba. La clave que pegaste debe ser la que Shopify muestra en esa página (“Tus webhooks se firmarán con…”).
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
