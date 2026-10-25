import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { ActionForm } from "@/components/action-form";
import { Card, Field, PageHeader } from "@/components/ui";
import { createClient } from "../actions";

export const metadata: Metadata = { title: "Nuevo cliente" };

export default async function NuevoClientePage() {
  await requireUser(["ADMIN"]);
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader eyebrow="Clientes" title="Nuevo cliente">
        El ID público (cmx…) y la referencia de pago se asignan solos.
      </PageHeader>
      <Card>
        <ActionForm action={createClient} submitLabel="Crear cliente">
          <Field label="Nombre del cliente" name="name" required />
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Contacto" name="contactName" />
            <Field label="Teléfono" name="phone" inputMode="tel" />
            <Field label="Correo" name="email" type="email" />
          </div>
          <Field label="Tarifa por envío (MXN)" name="tariffAmount" type="number" step="0.01" min="0" defaultValue="85" required />
          <p className="pt-2 text-sm font-medium text-slate-900">Sucursal de recolección</p>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Nombre" name="branchName" defaultValue="Matriz" required />
            <Field label="Dirección" name="branchAddress" required className="sm:col-span-2" />
          </div>
        </ActionForm>
      </Card>
    </div>
  );
}
