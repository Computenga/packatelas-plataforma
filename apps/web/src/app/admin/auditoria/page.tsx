import type { Metadata } from "next";
import { prisma } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import { fecha } from "@/lib/format";
import { PageHeader, Table, Td } from "@/components/ui";

export const metadata: Metadata = { title: "Auditoría" };

export default async function AuditoriaPage() {
  await requireUser(["ADMIN"]);
  const logs = await prisma.auditLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 300,
    include: { actor: { select: { name: true } } },
  });
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader eyebrow="Control" title="Auditoría de cambios">
        Últimos 300 cambios sensibles. No se guardan contraseñas ni llaves.
      </PageHeader>
      <Table head={["Fecha", "Quién", "Cambio", "Detalle"]} empty={logs.length ? undefined : "Sin cambios registrados"}>
        {logs.map((l) => (
          <tr key={l.id}>
            <Td className="text-slate-600">{fecha(l.createdAt)}</Td>
            <Td>{l.actor?.name ?? "Sistema"}</Td>
            <Td className="font-mono text-xs">{l.action}</Td>
            <Td className="whitespace-normal">{l.summary}</Td>
          </tr>
        ))}
      </Table>
    </div>
  );
}
