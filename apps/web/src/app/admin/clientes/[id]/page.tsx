import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getClientBalance, isPickupBlocked, prisma } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import { fecha, mxn } from "@/lib/format";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, Checkbox, Field, PageHeader, Select } from "@/components/ui";
import { addBranch, createPortalUser, linkMlAccount, updateClient, updateTariff } from "../actions";

export const metadata: Metadata = { title: "Cliente" };

const DAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

export default async function ClientePage({ params }: PageProps<"/admin/clientes/[id]">) {
  await requireUser(["ADMIN"]);
  const { id } = await params;
  const client = await prisma.client.findUnique({
    where: { id },
    include: {
      branches: { orderBy: { createdAt: "asc" } },
      mlAccounts: { include: { routes: { include: { branch: true } } }, orderBy: { nickname: "asc" } },
      users: { where: { role: "CLIENTE" }, orderBy: { username: "asc" } },
      _count: { select: { orders: true } },
    },
  });
  if (!client) notFound();

  const [balance, blocked] = await Promise.all([getClientBalance(prisma, id), isPickupBlocked(prisma, id)]);

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        eyebrow={`Cliente · ${client.publicId}`}
        title={client.name}
        actions={blocked ? <Badge tone="red">Recolección bloqueada</Badge> : <Badge tone="green">Recolección habilitada</Badge>}
      >
        {client._count.orders} envío(s) · Saldo{" "}
        <span className={balance.gt(0) ? "font-semibold text-red-600" : "font-semibold text-emerald-700"}>
          {mxn(balance)}
        </span>{" "}
        · Referencia de pago <span className="font-mono">{client.paymentReference}</span>
      </PageHeader>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Datos generales y fiscales">
          <ActionForm action={updateClient.bind(null, id)} submitLabel="Guardar datos">
            <Field label="Nombre" name="name" defaultValue={client.name} required />
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Contacto" name="contactName" defaultValue={client.contactName ?? ""} />
              <Field label="Teléfono" name="phone" defaultValue={client.phone ?? ""} />
              <Field label="Correo" name="email" type="email" defaultValue={client.email ?? ""} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="RFC" name="rfc" defaultValue={client.rfc ?? ""} />
              <Field label="Razón social" name="legalName" defaultValue={client.legalName ?? ""} />
              <Field label="Régimen fiscal" name="taxRegime" defaultValue={client.taxRegime ?? ""} hint="Clave SAT, p. ej. 601" />
              <Field label="C.P. fiscal" name="taxZip" defaultValue={client.taxZip ?? ""} />
              <Field label="Uso de CFDI" name="cfdiUse" defaultValue={client.cfdiUse ?? ""} hint="p. ej. G03" />
            </div>
            <Checkbox label="Cliente activo" name="active" defaultChecked={client.active} />
          </ActionForm>
        </Card>

        <div className="space-y-6">
          <Card title="Tarifa y cobro">
            <ActionForm action={updateTariff.bind(null, id)} submitLabel="Guardar tarifa">
              <Select label="Modalidad" name="tariffMode" defaultValue={client.tariffMode}>
                <option value="FIXED">Tarifa fija para todas las órdenes</option>
                <option value="FLEX_DYNAMIC_PLUS_FIXED">Flex dinámica + externos con tarifa fija</option>
              </Select>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Tarifa por envío (MXN)" name="tariffAmount" type="number" step="0.01" min="0" defaultValue={client.tariffAmount.toString()} />
                <Field
                  label="Límite de crédito (MXN)"
                  name="creditLimit"
                  type="number"
                  step="0.01"
                  min="0"
                  defaultValue={client.creditLimit?.toString() ?? ""}
                  hint="Si el saldo lo supera, se bloquean recolecciones. Vacío = 0."
                />
              </div>
              <Checkbox label="Cobro habilitado (se cobra al escanear)" name="chargingEnabled" defaultChecked={client.chargingEnabled} />
              {client.pickupExemptUntil && client.pickupExemptUntil > new Date() && (
                <p className="text-sm text-amber-700">Exento de bloqueo hasta {fecha(client.pickupExemptUntil)}</p>
              )}
            </ActionForm>
          </Card>

          <Card title="Acceso al portal cliente">
            {client.users.length > 0 && (
              <ul className="mb-4 space-y-1 text-sm">
                {client.users.map((u) => (
                  <li key={u.id} className="flex justify-between">
                    <span>
                      <span className="font-mono">{u.username}</span> · {u.name}
                    </span>
                    <span className="text-slate-500">{u.lastLoginAt ? `Último acceso ${fecha(u.lastLoginAt)}` : "Sin acceso aún"}</span>
                  </li>
                ))}
              </ul>
            )}
            <ActionForm action={createPortalUser.bind(null, id)} submitLabel="Crear acceso" resetOnSuccess>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Usuario" name="username" autoCapitalize="none" required />
                <Field label="Nombre" name="name" required />
                <Field label="Contraseña" name="password" type="password" minLength={8} required />
              </div>
            </ActionForm>
          </Card>
        </div>

        <Card title={`Sucursales (${client.branches.length})`}>
          <ul className="mb-5 divide-y divide-slate-100 text-sm">
            {client.branches.map((b) => (
              <li key={b.id} className="py-2">
                <p className="font-medium">
                  {b.name} {!b.active && <Badge>Inactiva</Badge>}
                </p>
                <p className="text-slate-600">{b.address}</p>
                <p className="text-xs text-slate-500">
                  {b.autoPickup ? `Recolección automática: ${b.autoPickupDays.map((d) => DAYS[d - 1]).join(", ")}` : "Recolección manual"}
                  {b.lat != null && ` · ${b.lat.toFixed(5)}, ${b.lng?.toFixed(5)}`}
                </p>
              </li>
            ))}
          </ul>
          <ActionForm action={addBranch.bind(null, id)} submitLabel="Agregar sucursal" resetOnSuccess>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Nombre" name="name" required />
              <Field label="Dirección" name="address" required className="sm:col-span-2" />
              <Field label="Teléfono" name="phone" />
              <Field label="Latitud" name="lat" inputMode="decimal" placeholder="19.43" />
              <Field label="Longitud" name="lng" inputMode="decimal" placeholder="-99.13" />
            </div>
            <fieldset>
              <legend className="text-sm font-medium text-slate-700">Recolección automática</legend>
              <div className="mt-1 flex flex-wrap gap-3">
                {DAYS.map((d, i) => (
                  <Checkbox key={d} label={d} name="autoPickupDays" value={String(i + 1)} />
                ))}
              </div>
            </fieldset>
          </ActionForm>
        </Card>

        <Card title={`Cuentas MercadoLibre (${client.mlAccounts.length})`}>
          <ul className="mb-5 divide-y divide-slate-100 text-sm">
            {client.mlAccounts.map((a) => (
              <li key={a.id} className="flex items-start justify-between gap-3 py-2">
                <div>
                  <p className="font-medium">{a.nickname}</p>
                  <p className="font-mono text-xs text-slate-500">{a.mlUserId.toString()}</p>
                  <p className="text-xs text-slate-500">→ {a.routes.map((r) => r.branch.name).join(", ") || "Sin sucursal"}</p>
                </div>
                {a.status === "ACTIVE" ? <Badge tone="green">Conectada</Badge> : <Badge tone="amber">Falta autorizar</Badge>}
              </li>
            ))}
          </ul>
          <p className="mb-3 text-xs text-slate-500">
            Ligar manualmente sirve para migrar las cuentas actuales. El cliente terminará la conexión desde su portal.
          </p>
          <ActionForm action={linkMlAccount.bind(null, id)} submitLabel="Ligar cuenta" resetOnSuccess>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="ID de vendedor ML" name="mlUserId" inputMode="numeric" required />
              <Field label="Nombre de la cuenta" name="nickname" required />
              <Select label="Llega a sucursal" name="branchId" required defaultValue={client.branches[0]?.id}>
                {client.branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </Select>
            </div>
          </ActionForm>
        </Card>
      </div>
    </div>
  );
}
