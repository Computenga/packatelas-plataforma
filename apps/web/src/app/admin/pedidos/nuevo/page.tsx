import type { Metadata } from "next";
import { prisma } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import { ActionForm } from "@/components/action-form";
import { Card, Field, PageHeader, Select, TextArea } from "@/components/ui";
import { createOrder } from "../actions";

export const metadata: Metadata = { title: "Nuevo pedido" };

export default async function NuevoPedidoPage() {
  await requireUser(["ADMIN", "OPERADOR"]);
  const clients = await prisma.client.findMany({
    where: { active: true },
    select: { id: true, name: true, branches: { where: { active: true }, select: { id: true, name: true } } },
    orderBy: { name: "asc" },
  });

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader eyebrow="Pedidos" title="Nuevo pedido">
        Para envíos que no vienen de MercadoLibre. Se le asigna un código PK- y se registra el cargo del cliente.
      </PageHeader>
      <Card>
        <ActionForm action={createOrder} submitLabel="Registrar pedido">
          <div className="grid gap-4 sm:grid-cols-2">
            <Select label="Cliente" name="clientId" required defaultValue="">
              <option value="" disabled>Elige un cliente</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
            <Select label="Sucursal de recolección" name="branchId" defaultValue="">
              <option value="">La principal del cliente</option>
              {clients.flatMap((c) =>
                c.branches.map((b) => (
                  <option key={b.id} value={b.id}>{c.name} · {b.name}</option>
                )),
              )}
            </Select>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Destinatario" name="recipientName" required />
            <Field label="Teléfono" name="recipientPhone" inputMode="tel" />
          </div>
          <Field label="Calle y número" name="addressLine" required />
          <div className="grid gap-4 sm:grid-cols-4">
            <Field label="Colonia" name="neighborhood" className="sm:col-span-2" />
            <Field label="Alcaldía / municipio" name="city" />
            <Field label="C.P." name="zip" inputMode="numeric" maxLength={5} />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Estado" name="state" defaultValue="CDMX" />
            <Field label="Latitud" name="lat" inputMode="decimal" hint="Opcional; pronto con buscador de direcciones" />
            <Field label="Longitud" name="lng" inputMode="decimal" />
          </div>
          <TextArea label="Instrucciones de entrega" name="instructions" rows={2} />
          <Field label="Contenido" name="itemsSummary" />
        </ActionForm>
      </Card>
    </div>
  );
}
