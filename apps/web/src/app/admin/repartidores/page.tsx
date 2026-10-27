import type { Metadata } from "next";
import { prisma } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import { fecha } from "@/lib/format";
import { ActionForm } from "@/components/action-form";
import { Badge, ButtonLink, Card, Checkbox, Field, PageHeader } from "@/components/ui";
import { linkFlex, unlinkFlex, updateDriver } from "./actions";
import { DriverFile } from "./driver-file";

export const metadata: Metadata = { title: "Repartidores" };

export default async function RepartidoresPage() {
  const me = await requireUser(["ADMIN", "DESPACHADOR"]);
  const drivers = await prisma.driver.findMany({
    include: {
      user: { select: { id: true, name: true, username: true, active: true } },
      flexIdentities: { orderBy: { createdAt: "asc" } },
      _count: { select: { orders: { where: { status: { in: ["ASSIGNED", "OUT_FOR_DELIVERY"] } } } } },
    },
    orderBy: [{ onDuty: "desc" }, { user: { name: "asc" } }],
  });
  const active = drivers.filter((d) => d.user.active);

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        eyebrow="Operación"
        title="Repartidores"
        actions={me.role === "ADMIN" && <ButtonLink href="/admin/usuarios" variant="secondary">Dar de alta</ButtonLink>}
      >
        {active.filter((d) => d.onDuty).length} en turno de {active.length} activos
      </PageHeader>

      <div className="grid gap-4 md:grid-cols-2">
        {active.map((d) => (
          <Card
            key={d.id}
            title={d.user.name}
            actions={d.onDuty ? <Badge tone="green">En turno</Badge> : <Badge>Fuera de turno</Badge>}
          >
            <p className="mb-3 text-xs text-slate-500">
              <span className="font-mono">{d.user.username}</span> · {d._count.orders} pedido(s) en curso · Última ubicación{" "}
              {fecha(d.lastLocationAt)}
            </p>
            <ActionForm action={updateDriver.bind(null, d.id)} submitLabel="Guardar">
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Teléfono" name="phone" defaultValue={d.phone ?? ""} />
                <Field label="Vehículo" name="vehicleType" defaultValue={d.vehicleType ?? ""} />
                <Field label="Placa" name="plate" defaultValue={d.plate ?? ""} />
              </div>
            </ActionForm>

            {me.role === "ADMIN" && <DriverFile driverId={d.id} userId={d.user.id} />}

            <div className="mt-5 border-t border-slate-100 pt-4">
              <p className="text-sm font-medium">Identidades Flex</p>
              <ul className="my-2 space-y-1">
                {d.flexIdentities.map((f) => (
                  <li key={f.id} className="flex items-center justify-between text-sm">
                    <span className="font-mono">{f.flexDriverId.toString()}</span>
                    <form action={unlinkFlex.bind(null, f.id)}>
                      <button className="text-xs text-red-600 hover:underline">Desvincular</button>
                    </form>
                  </li>
                ))}
                {d.flexIdentities.length === 0 && <li className="text-xs text-slate-500">Sin vincular</li>}
              </ul>
              <ActionForm action={linkFlex.bind(null, d.id)} submitLabel="Vincular" resetOnSuccess>
                <Field label="ID driver Flex" name="flexDriverId" inputMode="numeric" required />
                <Checkbox label="Reemplazar si ya está con otro repartidor" name="force" />
              </ActionForm>
            </div>
          </Card>
        ))}
        {active.length === 0 && <p className="text-slate-500">Aún no hay repartidores.</p>}
      </div>
    </div>
  );
}
