import type { Metadata } from "next";
import { prisma } from "@packatelas/db";
import { requireClient } from "@/lib/client-scope";
import { fecha } from "@/lib/format";
import { ActionForm } from "@/components/action-form";
import { AddressPicker } from "@/components/address-picker";
import { Badge, Card, Field } from "@/components/ui";
import { addBranchAction, addUserAction, removeBranchAction, toggleUserAction } from "./actions";

export const metadata: Metadata = { title: "Mi negocio" };

/** La tienda administra sus direcciones de recolección y los accesos de su equipo. */
export default async function NegocioPage() {
  const { user, clientId } = await requireClient();
  const [client, branches, users] = await Promise.all([
    prisma.client.findUniqueOrThrow({ where: { id: clientId }, select: { publicId: true, name: true } }),
    prisma.branch.findMany({ where: { clientId, active: true }, orderBy: { createdAt: "asc" } }),
    prisma.user.findMany({ where: { clientId, role: "CLIENTE" }, orderBy: { createdAt: "asc" }, select: { id: true, username: true, name: true, active: true, lastLoginAt: true } }),
  ]);
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-xl font-bold">Mi negocio</h1>

      <Card title="Direcciones de recolección">
        <p className="mb-3 text-sm text-slate-600">Aquí pasamos por tus paquetes. Agrega cada bodega o tienda donde quieras que recolectemos.</p>
        <ul className="mb-4 divide-y divide-slate-100 text-sm">
          {branches.map((b) => (
            <li key={b.id} className="flex items-start justify-between gap-3 py-2">
              <span>
                <span className="font-medium">{b.name}</span>
                <span className="block text-slate-600">{b.address}</span>
                {b.phone && <span className="block text-xs text-slate-500">Tel. {b.phone}</span>}
                {b.lat == null && <span className="block text-xs text-amber-700">Sin ubicación en el mapa: escríbenos para ubicarla bien.</span>}
              </span>
              {branches.length > 1 && (
                <ActionForm action={removeBranchAction.bind(null, b.id)} submitLabel="Quitar" className="shrink-0 space-y-1">
                  <span />
                </ActionForm>
              )}
            </li>
          ))}
          {branches.length === 0 && <li className="py-2 text-amber-700">Aún no tienes direcciones: agrega la primera.</li>}
        </ul>
        <details className="rounded-lg border border-slate-200 p-3" open={branches.length === 0}>
          <summary className="cursor-pointer text-sm font-semibold text-brand">+ Agregar dirección</summary>
          <ActionForm action={addBranchAction} submitLabel="Guardar dirección" resetOnSuccess className="mt-3 space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Nombre" name="name" required placeholder="Bodega Centro" />
              <Field label="Teléfono de quien entrega" name="phone" inputMode="tel" />
            </div>
            <AddressPicker variant="branch" />
          </ActionForm>
        </details>
      </Card>

      <Card title="Accesos de tu equipo">
        <p className="mb-3 text-sm text-slate-600">Da acceso al portal a quien te ayuda (ventas, bodega). Cada quien entra con su propio usuario y contraseña.</p>
        <ul className="mb-4 divide-y divide-slate-100 text-sm">
          {users.map((u) => (
            <li key={u.id} className="flex items-center justify-between gap-3 py-2">
              <span>
                <span className="font-mono text-xs">{u.username}</span> · {u.name} {u.id === user.id && <Badge tone="blue">Tú</Badge>} {!u.active && <Badge tone="red">Desactivado</Badge>}
                <span className="block text-xs text-slate-500">{u.lastLoginAt ? `Último acceso ${fecha(u.lastLoginAt)}` : "Aún no entra"}</span>
              </span>
              {u.id !== user.id && (
                <ActionForm action={toggleUserAction.bind(null, u.id)} submitLabel={u.active ? "Desactivar" : "Reactivar"} className="shrink-0 space-y-1">
                  <span />
                </ActionForm>
              )}
            </li>
          ))}
        </ul>
        <details className="rounded-lg border border-slate-200 p-3">
          <summary className="cursor-pointer text-sm font-semibold text-brand">+ Crear acceso</summary>
          <ActionForm action={addUserAction} submitLabel="Crear acceso" resetOnSuccess className="mt-3 space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Nombre de la persona" name="name" required />
              <label className="block text-sm">
                <span className="font-medium text-slate-700">Usuario</span>
                <span className="mt-1 flex items-center rounded-lg border border-slate-300 bg-white">
                  <span className="px-2 font-mono text-xs text-slate-500">{client.publicId}-</span>
                  <input name="suffix" required placeholder="ana" autoCapitalize="none" className="w-full rounded-r-lg px-2 py-2 text-sm outline-none" />
                </span>
              </label>
              <Field label="Contraseña" name="password" type="password" required minLength={8} hint="Mínimo 8, con letras y números. Compártela con la persona." />
            </div>
          </ActionForm>
        </details>
      </Card>
    </div>
  );
}
