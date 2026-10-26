import type { Metadata } from "next";
import Link from "next/link";
import { AGING_BUCKETS, agingReport, prisma } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import { mxn, soloFecha } from "@/lib/format";
import { ButtonLink, PageHeader, Table, Td } from "@/components/ui";
import { Stat } from "@/components/stat";
import { CobrosTabs } from "../tabs";

export const metadata: Metadata = { title: "Antigüedad de saldos" };

/** Reporte de cobranza [F11]: lo que se debe, por antigüedad de cada cargo sin pagar. */
export default async function AntiguedadPage() {
  await requireUser(["ADMIN"]);
  const rows = await agingReport(prisma);
  const clients = new Map(
    (await prisma.client.findMany({ where: { id: { in: rows.map((r) => r.clientId) } }, select: { id: true, name: true, publicId: true, creditMode: true, phone: true } })).map((c) => [c.id, c]),
  );
  const totals = Object.fromEntries(AGING_BUCKETS.map((b) => [b.key, rows.reduce((a, r) => a + r.buckets[b.key], 0)])) as Record<string, number>;
  const total = rows.reduce((a, r) => a + r.total, 0);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader eyebrow="Facturación" title="Cobros" actions={<ButtonLink href="/admin/cobros/antiguedad/exportar" variant="secondary" prefetch={false}>Exportar CSV</ButtonLink>}>
        Los pagos se aplican a los cargos más antiguos; lo que queda se agrupa por días desde el cargo.
      </PageHeader>
      <CobrosTabs active="antiguedad" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Por cobrar" value={mxn(total)} tone="red" hint={`${rows.length} cliente(s)`} />
        {AGING_BUCKETS.map((b, i) => (
          <Stat key={b.key} label={b.label} value={mxn(totals[b.key])} tone={i === 0 ? "green" : i === 1 ? "brand" : "amber"} />
        ))}
      </div>
      <Table head={["Cliente", "Forma", ...AGING_BUCKETS.map((b) => b.label), "Total", "Desde"]} empty={rows.length ? undefined : "Nadie debe"}>
        {rows.map((r) => {
          const c = clients.get(r.clientId);
          return (
            <tr key={r.clientId} className="hover:bg-slate-50">
              <Td>
                <Link href={`/admin/cobros/${r.clientId}`} className="font-medium text-brand hover:underline">{c?.name}</Link>
                <span className="ml-1 font-mono text-[11px] text-slate-400">{c?.publicId}</span>
              </Td>
              <Td className="text-xs">{c?.creditMode === "WEEKLY_CREDIT" ? "Crédito" : "Prepago"}</Td>
              {AGING_BUCKETS.map((b) => (
                <Td key={b.key} className={`text-right tabular-nums ${r.buckets[b.key] > 0 && b.max > 15 ? "font-semibold text-red-600" : ""}`}>
                  {r.buckets[b.key] > 0 ? mxn(r.buckets[b.key]) : "—"}
                </Td>
              ))}
              <Td className="text-right font-semibold tabular-nums">{mxn(r.total)}</Td>
              <Td className="text-xs text-slate-500">{soloFecha(r.oldest)}</Td>
            </tr>
          );
        })}
      </Table>
    </div>
  );
}
