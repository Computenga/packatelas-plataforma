import type { Metadata } from "next";
import Link from "next/link";
import { HIRE_ROLES, prisma } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import { Badge, Card, PageHeader, Table, Td } from "@/components/ui";
import { NewLink } from "./new-link";

export const metadata: Metadata = { title: "Altas" };
const STATUS = { EN_PROCESO: ["Llenando", "gray"], ENVIADA: ["Por revisar", "blue"], APROBADA: ["Aprobada", "green"], RECHAZADA: ["Rechazada", "red"] } as const;
const fmt = (d: Date) => d.toLocaleDateString("es-MX", { timeZone: "America/Mexico_City", day: "numeric", month: "short" });

/** Solicitudes de alta [A25]: primero las enviadas, luego las que siguen llenando. */
export default async function AltasPage({ searchParams }: PageProps<"/admin/personal/altas">) {
  const user = await requireUser(["ADMIN", "DESPACHADOR"]);
  const onlyDrivers = user.role !== "ADMIN";
  const all = (await searchParams).ver === "todas";
  const apps = await prisma.hireApplication.findMany({
    where: { ...(all ? {} : { status: { in: ["ENVIADA", "EN_PROCESO"] } }), ...(onlyDrivers ? { role: "repartidor" } : {}) },
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
    take: 200,
    include: { _count: { select: { documents: true } }, documents: { select: { status: true } } },
  });
  const order = { ENVIADA: 0, EN_PROCESO: 1, APROBADA: 2, RECHAZADA: 3 } as const;
  apps.sort((a, b) => order[a.status] - order[b.status]);
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <PageHeader eyebrow="Personal" title="Altas" actions={<Link href={all ? "?" : "?ver=todas"} className="text-sm text-brand">{all ? "Solo abiertas" : "Ver todas"}</Link>}>
        Manda el enlace a la persona; llena sus datos y sube sus documentos desde el celular. También puede registrarse sola en <span className="font-mono">portal.packatelas.mx/alta</span> (o desde «¿Quieres ser repartidor?» en el inicio de sesión).
        Los repartidores eligen su usuario y contraseña; al aprobarlos quedan activos en la app.{onlyDrivers && " Como despachador ves y apruebas solo las altas de repartidores."}
      </PageHeader>
      <Card title="Nuevo enlace de alta"><NewLink onlyDrivers={onlyDrivers} /></Card>
      <Table head={["Nombre", "Puesto", "Documentos", "Actualizada", "Estado"]} empty={apps.length ? undefined : "No hay solicitudes abiertas."}>
        {apps.map((a) => {
          const [label, tone] = STATUS[a.status];
          const pend = a.documents.filter((d) => d.status === "PENDIENTE").length;
          return (
            <tr key={a.id} className="hover:bg-slate-50">
              <Td><Link href={`/admin/personal/altas/${a.id}`} className="font-medium text-brand hover:underline">{a.name ?? "Sin nombre aún"}</Link></Td>
              <Td>{HIRE_ROLES[a.role] ?? a.role}</Td>
              <Td>{a._count.documents}{pend > 0 && <span className="text-xs text-blue-700"> · {pend} por revisar</span>}</Td>
              <Td>{fmt(a.updatedAt)}</Td>
              <Td><Badge tone={tone}>{label}</Badge></Td>
            </tr>
          );
        })}
      </Table>
    </div>
  );
}
