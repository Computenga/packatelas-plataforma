import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import { Badge, ButtonLink, PageHeader, Table, Td } from "@/components/ui";

export const metadata: Metadata = { title: "Personal" };
const DAY = ["", "L", "M", "X", "J", "V", "S", "D"];

export default async function PersonalPage({ searchParams }: PageProps<"/admin/personal">) {
  await requireUser(["ADMIN"]);
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const all = sp.ver === "todos";
  const emps = await prisma.employee.findMany({
    where: {
      ...(all ? {} : { status: "ACTIVO" }),
      ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { position: { contains: q, mode: "insensitive" } }, ...(Number(q) ? [{ employeeNo: Number(q) }] : [])] } : {}),
    },
    orderBy: { employeeNo: "asc" },
    include: { user: { select: { username: true, role: true } } },
  });
  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHeader
        eyebrow="Interno"
        title="Personal"
        actions={<><ButtonLink href="/admin/personal/importar" variant="secondary">Importar</ButtonLink><ButtonLink href="/admin/personal/nuevo">Nuevo empleado</ButtonLink></>}
      >
        Base maestra de empleados. El número es el mismo del ZKTeco y de la flotilla (U-número).
      </PageHeader>
      <form className="flex gap-2 text-sm">
        <input name="q" defaultValue={q} placeholder="Nombre, puesto o número" className="w-72 rounded-lg border border-slate-300 px-3 py-2" />
        <label className="flex items-center gap-1 text-slate-600"><input type="checkbox" name="ver" value="todos" defaultChecked={all} className="accent-brand" /> Incluir bajas</label>
        <button className="rounded-lg bg-brand px-4 text-white">Buscar</button>
      </form>
      <Table head={["No.", "Nombre", "Puesto", "Entrada", "Días", "Checadas", "Acceso", "Estatus"]} empty={emps.length ? undefined : "Sin empleados. Impórtalos desde la pestaña Personal del Sheet."}>
        {emps.map((e) => (
          <tr key={e.id} className="hover:bg-slate-50">
            <Td className="font-mono text-xs">{e.employeeNo}</Td>
            <Td><Link href={`/admin/personal/${e.id}`} className="font-medium text-brand hover:underline">{e.name}</Link></Td>
            <Td className="text-slate-600">{[e.position, e.area].filter(Boolean).join(" · ") || "—"}</Td>
            <Td>{e.entryTime ?? "—"}</Td>
            <Td className="font-mono text-xs">{e.workdays.map((d) => DAY[d]).join("")}</Td>
            <Td>{e.punchesPerDay}</Td>
            <Td className="text-xs">{e.user ? <span className="font-mono">{e.user.username}</span> : "—"}</Td>
            <Td>{e.status === "ACTIVO" ? <Badge tone="green">Activo</Badge> : <Badge>Baja</Badge>}</Td>
          </tr>
        ))}
      </Table>
    </div>
  );
}
