import type { Metadata } from "next";
import Link from "next/link";
import { dateOnly, generateAutoPickups, prisma } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import { PICKUP_LABEL } from "@/lib/format";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, Field, PageHeader, Select, Table, Td } from "@/components/ui";
import { assignPickupAction, newPickupAction } from "./actions";

export const metadata: Metadata = { title: "Recolecciones" };


const todayMx = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date());

export default async function RecoleccionesPage({ searchParams }: PageProps<"/admin/recolecciones">) {
  await requireUser(["ADMIN", "DESPACHADOR"]);
  const today = todayMx();
  const raw = String((await searchParams).date ?? today);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : today;
  if (date >= today) await generateAutoPickups(prisma, date); // idempotente

  const [pickups, drivers, branches] = await Promise.all([
    prisma.pickup.findMany({
      where: { scheduledFor: dateOnly(date) },
      include: { client: { select: { id: true, name: true } }, branch: true, driver: { include: { user: { select: { name: true } } } } },
      orderBy: [{ status: "asc" }, { client: { name: "asc" } }],
    }),
    prisma.driver.findMany({ where: { active: true, user: { active: true } }, include: { user: { select: { name: true } } }, orderBy: { user: { name: "asc" } } }),
    prisma.branch.findMany({ where: { active: true, client: { active: true } }, include: { client: { select: { name: true } } }, orderBy: { client: { name: "asc" } } }),
  ]);

  const shift = (days: number) => {
    const d = dateOnly(date);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader eyebrow="Operación" title="Recolecciones">
        Las automáticas se generan solas según los días de cada sucursal. Las de clientes con adeudo quedan bloqueadas.
      </PageHeader>

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <Link href={`?date=${shift(-1)}`} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5">← Anterior</Link>
        <form className="flex gap-2">
          <input type="date" name="date" defaultValue={date} className="rounded-lg border border-slate-300 px-2 py-1.5" />
          <button className="rounded-lg bg-brand px-3 text-white">Ver</button>
        </form>
        <Link href={`?date=${shift(1)}`} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5">Siguiente →</Link>
        {date !== today && <Link href="?" className="text-brand">Hoy</Link>}
      </div>

      <Table head={["Cliente", "Sucursal", "Tipo", "Estado", "Paquetes", "Repartidor"]} empty={pickups.length ? undefined : "Sin recolecciones para este día"}>
        {pickups.map((p) => {
          const [label, tone] = PICKUP_LABEL[p.status];
          const open = ["SCHEDULED", "ASSIGNED", "FAILED"].includes(p.status);
          return (
            <tr key={p.id}>
              <Td><Link href={`/admin/cobros/${p.client.id}`} className="text-brand hover:underline">{p.client.name}</Link></Td>
              <Td className="whitespace-normal"><span className="font-medium">{p.branch.name}</span><span className="block text-xs text-slate-500">{p.branch.address}</span></Td>
              <Td>{p.automatic ? "Automática" : "Solicitada"}</Td>
              <Td><Badge tone={tone}>{label}</Badge></Td>
              <Td>{p.collectedCount ?? p.expectedCount ?? "—"}</Td>
              <Td>
                {open ? (
                  <form action={assignPickupAction.bind(null, p.id)} className="flex gap-1">
                    <select name="driverId" defaultValue={p.driverId ?? ""} className="rounded border border-slate-300 px-1 py-1 text-sm" aria-label="Repartidor">
                      <option value="" disabled>Elegir…</option>
                      {drivers.map((d) => (
                        <option key={d.id} value={d.id}>{d.user.name}</option>
                      ))}
                    </select>
                    <button className="rounded bg-brand px-2 text-xs text-white">Asignar</button>
                  </form>
                ) : (
                  p.driver?.user.name ?? "—"
                )}
              </Td>
            </tr>
          );
        })}
      </Table>

      <Card title="Nueva recolección">
        <ActionForm action={newPickupAction} submitLabel="Crear recolección" resetOnSuccess>
          <div className="grid gap-3 md:grid-cols-4">
            <Select label="Sucursal" name="branchId" required defaultValue="" className="md:col-span-2">
              <option value="" disabled>Elige cliente y sucursal</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.client.name} · {b.name}</option>
              ))}
            </Select>
            <Field label="Fecha" name="date" type="date" defaultValue={date} min={today} required />
            <Field label="Paquetes aprox." name="expectedCount" type="number" min="1" />
          </div>
          <Field label="Nota" name="note" />
        </ActionForm>
      </Card>
    </div>
  );
}
