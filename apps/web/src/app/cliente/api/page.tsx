import type { Metadata } from "next";
import Link from "next/link";
import { prisma, webhookSecret } from "@packatelas/db";
import { requireClient } from "@/lib/client-scope";
import { fecha } from "@/lib/format";
import { ActionForm } from "@/components/action-form";
import { Badge, Button, Card, Field, PageHeader, Table, Td } from "@/components/ui";
import { KeyForm, Secret } from "./key-form";
import { disableWebhookAction, retryDeliveryAction, revokeKeyAction, rotateSecretAction, saveWebhookAction } from "./actions";

export const metadata: Metadata = { title: "API e integraciones" };

const TONE = { PENDING: "amber", SENT: "green", FAILED: "red" } as const;
const LABEL = { PENDING: "Pendiente", SENT: "Enviado", FAILED: "Falló" } as const;

/** Llaves de API, webhook y documentación para el sistema del cliente [I08]. */
export default async function ApiPage() {
  const { clientId } = await requireClient();
  const [keys, ep] = await Promise.all([
    prisma.apiKey.findMany({ where: { clientId }, orderBy: { createdAt: "desc" } }),
    prisma.webhookEndpoint.findUnique({ where: { clientId } }),
  ]);
  const deliveries = ep ? await prisma.webhookDelivery.findMany({ where: { endpointId: ep.id }, orderBy: { createdAt: "desc" }, take: 20 }) : [];
  const base = (process.env.PUBLIC_URL ?? "https://admin.packatelas.mx").replace(/\/$/, "");

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader eyebrow="Cuenta" title="API e integraciones">
        Conecta tu tienda o sistema para crear envíos y recibir sus cambios de estado en automático. <Link href="/cliente/cuenta" className="text-brand hover:underline">← Mi cuenta</Link>
      </PageHeader>

      <Card title="Llaves de API">
        <KeyForm />
        {keys.length > 0 && (
          <ul className="mt-4 divide-y divide-slate-100 text-sm">
            {keys.map((k) => (
              <li key={k.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  <span className="font-medium">{k.name}</span> <code className="font-mono text-xs text-slate-500">{k.prefix}…</code>
                  <span className="block text-xs text-slate-500">Creada {fecha(k.createdAt)} · {k.lastUsedAt ? `último uso ${fecha(k.lastUsedAt)}` : "sin usar"}</span>
                </span>
                {k.revokedAt ? <Badge>Revocada</Badge> : (
                  <form action={revokeKeyAction.bind(null, k.id)}><Button variant="secondary">Revocar</Button></form>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Webhook de cambios de estado">
        <ActionForm action={saveWebhookAction} submitLabel={ep ? "Guardar" : "Activar webhook"}>
          <Field name="url" label="URL de tu sistema (https)" type="url" required defaultValue={ep?.url ?? ""} placeholder="https://mitienda.com/webhooks/packatelas" />
        </ActionForm>
        {ep && (
          <div className="mt-4 space-y-2 text-sm">
            <p>Estado: {ep.active ? <Badge tone="green">Activo</Badge> : <Badge>Desactivado</Badge>}</p>
            <p>Secreto para validar la firma: <Secret value={webhookSecret(ep.secret)} /></p>
            <div className="flex flex-wrap gap-2">
              <form action={rotateSecretAction}><Button variant="secondary">Renovar secreto</Button></form>
              {ep.active && <form action={disableWebhookAction}><Button variant="ghost">Desactivar</Button></form>}
            </div>
          </div>
        )}
      </Card>

      {deliveries.length > 0 && (
        <Table head={["Fecha", "Envío", "Estado", "Resultado", ""]}>
          {deliveries.map((d) => {
            const p = d.payload as { codigo?: string; estado_texto?: string };
            return (
              <tr key={d.id}>
                <Td>{fecha(d.createdAt)}</Td>
                <Td><span className="font-mono text-xs">{p.codigo}</span></Td>
                <Td>{p.estado_texto}</Td>
                <Td><Badge tone={TONE[d.status]}>{LABEL[d.status]}</Badge>{d.lastError && <span className="block text-xs text-slate-500">{d.lastError} · {d.attempts} intento(s)</span>}</Td>
                <Td>{d.status === "FAILED" && <form action={retryDeliveryAction.bind(null, d.id)}><button className="text-sm text-brand hover:underline">Reintentar</button></form>}</Td>
              </tr>
            );
          })}
        </Table>
      )}

      <Card title="Cómo usarla">
        <div className="space-y-4 text-sm text-slate-700">
          <p>Envía tu llave en cada solicitud: <code className="font-mono text-xs">Authorization: Bearer pk_live_…</code>. Máximo 120 solicitudes por minuto.</p>
          <div>
            <p className="font-medium">Crear un envío</p>
            <pre className="mt-1 overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100">{`curl -X POST ${base}/api/v1/envios \\
  -H "Authorization: Bearer pk_live_…" \\
  -H "Content-Type: application/json" \\
  -d '{
    "referencia": "PEDIDO-1001",
    "destinatario": { "nombre": "Ana López", "telefono": "5512345678" },
    "direccion": { "calle": "Av. Insurgentes Sur 1234", "colonia": "Del Valle",
                   "ciudad": "Benito Juárez", "estado": "CDMX", "cp": "03100",
                   "indicaciones": "Tocar el timbre 3" },
    "contenido": "1 caja mediana"
  }'`}</pre>
            <p className="mt-1 text-xs text-slate-500">
              <code>referencia</code> es tu número de pedido: si repites la misma, recibes el envío ya creado en lugar de uno duplicado. Puedes mandar <code>lat</code> y <code>lng</code>; si no, ubicamos la dirección. Se cobra con tu tarifa, igual que un envío creado en el portal.
            </p>
          </div>
          <div>
            <p className="font-medium">Consultar</p>
            <pre className="mt-1 overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100">{`GET ${base}/api/v1/envios/PEDIDO-1001        (por tu referencia o por código PK-…/ML-…)
GET ${base}/api/v1/envios?estado=DELIVERED&desde=2026-10-01&hasta=2026-10-15&pagina=1`}</pre>
          </div>
          <div>
            <p className="font-medium">Estados</p>
            <p className="text-xs">CREATED registrado · ASSIGNED asignado · OUT_FOR_DELIVERY en camino · DELIVERED entregado · FAILED no entregado · RESCHEDULED reprogramado · RETURNING regresa a bodega · RETURNED_TO_WAREHOUSE en bodega · RETURNED_TO_SELLER devuelto · CANCELLED cancelado.</p>
          </div>
          <div>
            <p className="font-medium">Webhook</p>
            <p>En cada cambio de estado hacemos un POST a tu URL con este cuerpo:</p>
            <pre className="mt-1 overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100">{`{ "id": "…", "evento": "envio.estado", "codigo": "PK-000123", "referencia": "PEDIDO-1001",
  "estado": "DELIVERED", "estado_texto": "Entregado", "estado_anterior": "OUT_FOR_DELIVERY",
  "ocurrio": "2026-10-20T22:10:00.000Z", "nota": null }`}</pre>
            <p className="mt-1">
              Valida la firma: calcula HMAC-SHA256 con tu secreto sobre <code>{"<X-Packatelas-Timestamp>.<cuerpo>"}</code> y compáralo con el encabezado <code>X-Packatelas-Signature</code> (<code>sha256=…</code>). Responde 2xx; si no, reintentamos hasta 8 veces con espera creciente. El <code>id</code> sirve para ignorar repetidos.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}
