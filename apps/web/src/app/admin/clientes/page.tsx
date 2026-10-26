import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import { mxn } from "@/lib/format";
import { Badge, ButtonLink, PageHeader, Table, Td } from "@/components/ui";

export const metadata: Metadata = { title: "Clientes" };

export default async function ClientesPage({ searchParams }: PageProps<"/admin/clientes">) {
  await requireUser(["ADMIN"]);
  const signups = await prisma.clientSignup.count({ where: { status: "PENDING" } });
  const q = String((await searchParams).q ?? "").trim();

  const clients = await prisma.client.findMany({
    where: q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { publicId: { contains: q, mode: "insensitive" } },
            { mlAccounts: { some: { nickname: { contains: q, mode: "insensitive" } } } },
          ],
        }
      : undefined,
    orderBy: { name: "asc" },
    include: { _count: { select: { branches: true, mlAccounts: true } } },
    take: 300,
  });
  const balances = await prisma.ledgerEntry.groupBy({
    by: ["clientId"],
    where: { clientId: { in: clients.map((c) => c.id) } },
    _sum: { amount: true },
  });
  const balanceOf = new Map(balances.map((b) => [b.clientId, Number(b._sum.amount ?? 0)]));

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader eyebrow="Gestión" title="Clientes" actions={<><ButtonLink href="/admin/clientes/solicitudes" variant="secondary">Solicitudes{signups ? ` (${signups})` : ""}</ButtonLink><ButtonLink href="/admin/clientes/importar" variant="secondary">Importar</ButtonLink><ButtonLink href="/admin/clientes/nuevo">Nuevo cliente</ButtonLink></>}>
        {clients.length} cliente(s){q && ` para "${q}"`}
      </PageHeader>

      <form className="mb-4">
        <input
          name="q"
          defaultValue={q}
          placeholder="Buscar por nombre, ID (cmx/emx…) o cuenta ML"
          className="w-full max-w-md rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
      </form>

      <Table head={["Cliente", "ID", "Tarifa", "Sucursales", "Cuentas ML", "Saldo", ""]} empty={clients.length ? undefined : "Sin clientes"}>
        {clients.map((c) => {
          const bal = balanceOf.get(c.id) ?? 0;
          return (
            <tr key={c.id} className="hover:bg-slate-50">
              <Td>
                <Link href={`/admin/clientes/${c.id}`} className="font-medium text-brand hover:underline">
                  {c.name}
                </Link>
              </Td>
              <Td className="font-mono text-xs">{c.publicId}</Td>
              <Td>{c.chargingEnabled ? mxn(c.tariffAmount) : <Badge>Sin cobro</Badge>}</Td>
              <Td>{c._count.branches}</Td>
              <Td>{c._count.mlAccounts}</Td>
              <Td className={bal > 0 ? "font-medium text-red-600" : "text-slate-600"}>{mxn(bal)}</Td>
              <Td>{!c.active && <Badge tone="gray">Inactivo</Badge>}</Td>
            </tr>
          );
        })}
      </Table>
    </div>
  );
}
