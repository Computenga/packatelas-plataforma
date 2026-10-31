import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { custodyFlag, mlStatusText, prisma, type CustodyEnd } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import { fecha, hace, STATUS_LABEL, STATUS_TONE } from "@/lib/format";
import { Badge, ButtonLink, Card, PageHeader, Table, Td } from "@/components/ui";
import { period } from "../period";

export const metadata: Metadata = { title: "Inventario del repartidor" };
const requestTime = () => new Date();

const END: Record<CustodyEnd, [string, "green" | "blue" | "gray" | "amber"]> = {
  DELIVERED: ["Entregado y confirmado", "green"],
  RETURNED: ["Recibido de vuelta", "blue"],
  TRANSFERRED: ["Traspasado", "gray"],
  UNASSIGNED: ["Quitado por despacho", "gray"],
};

export default async function InventarioRepartidor({ params, searchParams }: PageProps<"/admin/inventario/[driverId]">) {
  await requireUser(["ADMIN", "DESPACHADOR"]);
  const { driverId } = await params;
  const now = requestTime();
  const p = period(await searchParams, now);
  const driver = await prisma.driver.findUnique({ where: { id: driverId }, select: { id: true, phone: true, user: { select: { name: true } } } });
  if (!driver) notFound();

  const orderSel = {
    id: true, code: true, status: true, mlShipmentId: true, mlStatus: true, mlSubstatus: true, addressLine: true,
    client: { select: { name: true } },
    _count: { select: { evidence: { where: { kind: "PHOTO" as const } } } },
  };
  const [open, moves] = await Promise.all([
    prisma.driverCustody.findMany({ where: { driverId, endedAt: null }, orderBy: { startedAt: "asc" }, select: { id: true, startedAt: true, how: true, order: { select: orderSel } } }),
    prisma.driverCustody.findMany({
      where: { driverId, OR: [{ startedAt: { gte: p.from, lt: p.to }, how: { not: "inicial" } }, { endedAt: { gte: p.from, lt: p.to } }] },
      orderBy: { startedAt: "desc" },
      take: 500,
      select: { id: true, startedAt: true, endedAt: true, endReason: true, how: true, order: { select: { id: true, code: true, client: { select: { name: true } } } } },
    }),
  ]);
  const received = moves.filter((m) => m.startedAt >= p.from && m.startedAt < p.to && m.how !== "inicial").length;
  const endedIn = (r: CustodyEnd) => moves.filter((m) => m.endReason === r && m.endedAt && m.endedAt >= p.from && m.endedAt < p.to).length;
  const qs = `desde=${p.desde}&hasta=${p.hasta}`;

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <PageHeader eyebrow="Inventario" title={driver.user.name} actions={<ButtonLink href={`/admin/inventario?${qs}`} variant="secondary">Todos los repartidores</ButtonLink>}>
        Debe traer <strong>{open.length}</strong> paquete(s). Del {p.desde} al {p.hasta}: recibió {received}, entregó {endedIn("DELIVERED")}, regresó {endedIn("RETURNED")}.
      </PageHeader>

      <Card title={`En su poder (${open.length})`}>
        {open.length === 0 ? (
          <p className="text-sm text-slate-500">No tiene paquetes pendientes.</p>
        ) : (
          <Table head={["Pedido", "Cliente", "Estado", "ML", "Lo tiene desde", "Pendiente"]}>
            {open.map((c) => {
              const flag = custodyFlag({ status: c.order.status, mlShipmentId: c.order.mlShipmentId, mlStatus: c.order.mlStatus, photos: c.order._count.evidence });
              const old = now.getTime() - c.startedAt.getTime() > 86_400_000;
              return (
                <tr key={c.id}>
                  <Td>
                    <Link href={`/admin/pedidos/${c.order.id}`} className="font-mono text-brand underline-offset-2 hover:underline">{c.order.code}</Link>
                  </Td>
                  <Td className="max-w-48 truncate">{c.order.client.name}</Td>
                  <Td><Badge tone={STATUS_TONE[c.order.status]}>{STATUS_LABEL[c.order.status]}</Badge></Td>
                  <Td className="text-xs text-slate-500">{c.order.mlStatus ? mlStatusText(c.order.mlStatus, c.order.mlSubstatus) : "—"}</Td>
                  <Td className={old ? "font-medium text-red-700" : ""}>
                    {fecha(c.startedAt)} <span className="text-xs text-slate-500">· hace {hace(c.startedAt, now.getTime())}</span>
                  </Td>
                  <Td className="text-xs text-amber-800">{flag ?? ""}</Td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>

      <Card title={`Movimientos del periodo (${moves.length})`}>
        {moves.length === 0 ? (
          <p className="text-sm text-slate-500">Sin movimientos en el periodo.</p>
        ) : (
          <Table head={["Pedido", "Cliente", "Entró", "Cómo", "Salió", "Motivo"]}>
            {moves.map((m) => (
              <tr key={m.id}>
                <Td>
                  <Link href={`/admin/pedidos/${m.order.id}`} className="font-mono text-brand underline-offset-2 hover:underline">{m.order.code}</Link>
                </Td>
                <Td className="max-w-48 truncate">{m.order.client.name}</Td>
                <Td>{fecha(m.startedAt)}</Td>
                <Td className="text-xs text-slate-500">{m.how}</Td>
                <Td>{m.endedAt ? fecha(m.endedAt) : <span className="text-slate-400">sigue con él</span>}</Td>
                <Td>{m.endReason ? <Badge tone={END[m.endReason][1]}>{END[m.endReason][0]}</Badge> : ""}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
