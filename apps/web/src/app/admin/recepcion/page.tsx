import type { Metadata } from "next";
import Link from "next/link";
import { prisma, todayMx } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import { Badge, Card, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Recepción" };

const HM = new Intl.DateTimeFormat("es-MX", { timeZone: "America/Mexico_City", hour: "2-digit", minute: "2-digit" });
type Pkg = { code: string };

/** Bitácora del vigilante: llegadas firmadas y salidas a ruta, por día. Sustituye la lista de papel. */
export default async function AdminRecepcionPage({ searchParams }: PageProps<"/admin/recepcion">) {
  await requireUser(["ADMIN", "DESPACHADOR"]);
  const sp = await searchParams;
  const ymd = /^\d{4}-\d{2}-\d{2}$/.test(String(sp.dia ?? "")) ? String(sp.dia) : todayMx();
  const rows = await prisma.gateCheck.findMany({
    where: { ymd },
    orderBy: { at: "desc" },
    include: { driver: { select: { user: { select: { name: true, employee: { select: { employeeNo: true } } } } } } },
  });
  const guards = new Map((await prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.guardId).filter((x): x is string => !!x))] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const llegadas = rows.filter((r) => r.kind === "LLEGADA");
  const salidas = rows.filter((r) => r.kind === "SALIDA");

  const table = (list: typeof rows, kind: "LLEGADA" | "SALIDA") => (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-xs uppercase text-slate-500">
          <tr><th className="py-2">Hora</th><th>Repartidor</th><th>{kind === "LLEGADA" ? "Debía / escaneó" : "Llevaba"}</th><th>Resultado</th><th>Diferencias</th><th>Identificado</th><th>Registró</th>{kind === "LLEGADA" && <th>Firma</th>}</tr>
        </thead>
        <tbody>
          {list.map((r) => {
            const extra = r.extra as Pkg[];
            const missing = r.missing as Pkg[];
            return (
              <tr key={r.id} className={`border-t border-slate-100 align-top ${r.ok ? "" : "bg-red-50"}`}>
                <td className="py-2">{HM.format(r.at)}</td>
                <td className="font-medium">{r.driver.user.name}<span className="text-slate-400"> #{r.driver.user.employee?.employeeNo ?? "—"}</span></td>
                <td>{kind === "LLEGADA" ? `${(r.expected as Pkg[]).length} / ${(r.scanned as Pkg[]).length}` : (r.expected as Pkg[]).length}</td>
                <td>{r.ok ? <Badge tone="green">Cuadra</Badge> : <Badge tone="red">{r.audited ? "Auditoría" : "No cuadra"}</Badge>}</td>
                <td className="max-w-xs text-xs">
                  {extra.length > 0 && <p className="text-red-700">No suyos: <span className="font-mono">{extra.map((e) => e.code).join(", ")}</span></p>}
                  {missing.length > 0 && <p className="text-amber-700">Faltan: <span className="font-mono">{missing.map((m) => m.code).join(", ")}</span></p>}
                </td>
                <td className="text-xs">{r.identifiedBy}</td>
                <td className="text-xs">{r.guardId ? guards.get(r.guardId) ?? "—" : "—"}</td>
                {kind === "LLEGADA" && (
                  <td>{r.signatureKey && (
                    // eslint-disable-next-line @next/next/no-img-element -- firma privada
                    <a href={`/api/recepcion/firma/${r.signatureKey}`} target="_blank" rel="noreferrer"><img src={`/api/recepcion/firma/${r.signatureKey}`} alt="Firma" className="h-10 w-28 rounded border border-slate-200 bg-white object-contain" /></a>
                  )}</td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      {list.length === 0 && <p className="py-4 text-sm text-slate-500">Sin registros este día.</p>}
    </div>
  );

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader eyebrow="Operación" title="Recepción" actions={<Link href="/recepcion" className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white">Abrir pantalla del vigilante</Link>}>
        Lo que registra el vigilante: llegada en la mañana (escaneo de todo lo que traen + firma) y salida a ruta (un paquete al azar; si no es suyo, auditoría).
      </PageHeader>
      <form className="flex items-center gap-2 text-sm">
        <input type="date" name="dia" defaultValue={ymd} className="rounded-lg border border-slate-300 px-3 py-2" />
        <button className="rounded-lg border border-slate-300 bg-white px-3 py-2">Ver</button>
      </form>
      <Card title={`☀️ Llegadas (${llegadas.length}) · ${llegadas.filter((r) => !r.ok).length} no cuadran`}>{table(llegadas, "LLEGADA")}</Card>
      <Card title={`🛵 Salidas a ruta (${salidas.length}) · ${salidas.filter((r) => r.audited).length} auditorías`}>{table(salidas, "SALIDA")}</Card>
    </div>
  );
}
