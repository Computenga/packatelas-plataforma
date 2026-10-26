import type { Metadata } from "next";
import { prisma } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import { ActionForm } from "@/components/action-form";
import { AddressPicker } from "@/components/address-picker";
import { Field, Select } from "@/components/ui";
import { createExternal } from "../actions";

export const metadata: Metadata = { title: "Paquete externo" };

export default async function ExternoPage({ searchParams }: PageProps<"/repartidor/externo">) {
  await requireUser(["REPARTIDOR"]);
  const ref = String((await searchParams).ref ?? "").slice(0, 120);
  const clients = await prisma.client.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } });

  return (
    <div>
      <h1 className="mb-1 text-lg font-bold">Alta de paquete externo</h1>
      <p className="mb-4 text-sm text-slate-600">Queda en tu ruta y se le cobra al cliente.</p>
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <ActionForm action={createExternal} submitLabel="Agregar a mi ruta">
          <input type="hidden" name="ref" value={ref} />
          {ref && <p className="text-xs text-slate-500">Etiqueta: <span className="font-mono">{ref}</span></p>}
          <Select label="Cliente" name="clientId" required defaultValue="">
            <option value="" disabled>Elige el cliente</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>
          <Field label="Quién recibe" name="recipientName" required />
          <Field label="Teléfono" name="recipientPhone" inputMode="tel" />
          <AddressPicker />
        </ActionForm>
      </div>
    </div>
  );
}
