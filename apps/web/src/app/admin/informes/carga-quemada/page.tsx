import type { Metadata } from "next";
import Link from "next/link";
import { burnedReport, prisma } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import { fecha } from "@/lib/format";
import { readRange } from "@/lib/report-range";
import { Badge, ButtonLink, PageHeader, Table, Td } from "@/components/ui";
import { Stat } from "@/components/stat";
import { RangeForm } from "../range-form";

export const metadata: Metadata = { title: "Carga quemada" };

const KIND = {
  llego_quemada: { label: "Llegó quemada", tone: "gray" as const, hint: "El compromiso ya había vencido al recibirlo" },
  entrega_tarde: { label: "Entrega tarde", tone: "amber" as const, hint: "Llegó a tiempo y se entregó después del día compromiso" },
  vencida: { label: "Vencida", tone: "red" as const, hint: "Llegó a tiempo y sigue sin entregarse" },
};

/** Pedidos que no cumplieron su fecha compromiso [A18]. */
export default async function CargaQuemadaPage({ searchParams }: PageProps<"/admin/informes/carga-quemada">) {
  await requireUser(["ADMIN"]);
  const sp = await searchParams;
  const { fromYmd, toYmd, range } = readRange(sp);
  const kind = (["llego_quemada", "entrega_tarde", "vencida"] as const).find((k) => k === sp.tipo);
  const all = await burnedReport(prisma, range);
  const rows = kind ? all.filter((r) => r.kind === kind) : all;
  const count = (k: keyof typeof KIND) => all.filter((r) => r.kind === k).length;
  const withPromise = await prisma.order.count({ where: { createdAt: { gte: range.from, lt: range.to }, requestedDeliveryAt: { not: null } } });
  const qs = (extra: Record<string, string>) => new URLSearchParams({ from: fromYmd, to: toYmd, ...extra }).toString();

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <PageHeader
        eyebrow="Informes"
        title="Carga quemada"
        actions={<ButtonLink href={`/admin/informes/exportar?${qs({ tab: "carga-quemada" })}`} variant="secondary" prefetch={false}>Exportar CSV</ButtonLink>}
      >
        Envíos que no cumplieron su fecha compromiso de MercadoLibre. <Link href={`/admin/informes?${qs({})}`} className="text-brand hover:underline">← Informes</Link>
      </PageHeader>
      <RangeForm base="/admin/informes/carga-quemada" fromYmd={fromYmd} toYmd={toYmd} extra={kind ? { tipo: kind } : {}} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Con fecha compromiso" value={withPromise} hint="Registrados en el periodo" />
        {(Object.keys(KIND) as (keyof typeof KIND)[]).map((k) => (
          <Link key={k} href={`/admin/informes/carga-quemada?${qs(kind === k ? {} : { tipo: k })}`}>
            <Stat label={KIND[k].label} value={count(k)} tone={k === "vencida" ? "red" : k === "entrega_tarde" ? "amber" : "brand"} hint={KIND[k].hint} />
          </Link>
        ))}
      </div>
      <Table head={["Tipo", "Envío", "Cliente", "Registrado", "Compromiso", "Entregado"]} empty={withPromise ? (rows.length ? undefined : "Todo a tiempo en el periodo") : "Aún no hay fechas compromiso: llegan de MercadoLibre al conectar la API."}>
        {rows.slice(0, 1000).map((r) => (
          <tr key={r.id} className="hover:bg-slate-50">
            <Td><Badge tone={KIND[r.kind].tone}>{KIND[r.kind].label}</Badge></Td>
            <Td><Link href={`/admin/pedidos/${r.id}`} className="font-mono text-xs text-brand hover:underline">{r.code}</Link></Td>
            <Td>{r.client} <span className="font-mono text-[11px] text-slate-400">{r.publicId}</span></Td>
            <Td>{fecha(r.createdAt)}</Td>
            <Td>{fecha(r.promisedAt)}</Td>
            <Td>{fecha(r.deliveredAt)}</Td>
          </tr>
        ))}
      </Table>
    </div>
  );
}
