import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@packatelas/db";
import { requireClient } from "@/lib/client-scope";
import { mxn } from "@/lib/format";
import { ActionForm } from "@/components/action-form";
import { AddressPicker } from "@/components/address-picker";
import { Card, Field, Select, TextArea } from "@/components/ui";
import { createClientOrder } from "./actions";

export const metadata: Metadata = { title: "Nuevo envío" };

export default async function NuevoEnvioPage() {
  const { clientId } = await requireClient();
  const client = await prisma.client.findUniqueOrThrow({
    where: { id: clientId },
    select: { tariffAmount: true, branches: { where: { active: true }, select: { id: true, name: true, address: true } } },
  });

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Nuevo envío</h1>
          <p className="text-sm text-slate-600">Para paquetes que no vienen de MercadoLibre. Costo: {mxn(client.tariffAmount)}.</p>
        </div>
        <Link href="/cliente/carga" className="shrink-0 text-sm text-brand hover:underline">Cargar varios</Link>
      </div>
      <Card>
        <ActionForm action={createClientOrder} submitLabel="Registrar envío">
          {client.branches.length > 1 && (
            <Select label="Se recolecta en" name="branchId" defaultValue={client.branches[0].id}>
              {client.branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name} · {b.address}</option>
              ))}
            </Select>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Quién recibe" name="recipientName" required autoComplete="off" />
            <Field label="Teléfono de quien recibe" name="recipientPhone" inputMode="tel" />
          </div>
          <AddressPicker />
          <TextArea label="Referencias para el repartidor" name="instructions" rows={2} />
          <Field label="Contenido (opcional)" name="itemsSummary" />
        </ActionForm>
      </Card>
      <p className="text-xs text-slate-500">Pega la etiqueta con el código PK- que te mostramos al terminar, o escribe el código en el paquete.</p>
    </div>
  );
}
