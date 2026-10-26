import { burnedReport, clientReport, driverReport, prisma, zoneReport } from "@packatelas/db";
import { getSessionUser } from "@/lib/session";
import { fecha } from "@/lib/format";
import { readRange } from "@/lib/report-range";

const cell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
const KIND: Record<string, string> = { llego_quemada: "Llegó quemada", entrega_tarde: "Entrega tarde", vencida: "Vencida sin entregar" };

/** CSV de informes [A17, A18]. */
export async function GET(request: Request) {
  const user = await getSessionUser();
  if (user?.role !== "ADMIN") return new Response("No autorizado", { status: 401 });
  const sp = Object.fromEntries(new URL(request.url).searchParams);
  const { fromYmd, toYmd, range } = readRange(sp);
  let rows: unknown[][] = [];
  if (sp.tab === "clientes") {
    rows = [["Cliente", "ID", "Envíos", "Entregados", "Intentos fallidos", "Devoluciones", "Cargos"],
      ...(await clientReport(prisma, range)).map((c) => [c.name, c.publicId, c.created, c.delivered, c.failedAttempts, c.returned, c.charged.toFixed(2)])];
  } else if (sp.tab === "zonas") {
    rows = [[sp.por === "cp" ? "CP" : "Alcaldía / municipio", "Envíos", "Entregados", "Con intento fallido", "Efectividad %"],
      ...(await zoneReport(prisma, range, sp.por === "cp" ? "zip" : "city")).map((z) => [z.zone, z.created, z.delivered, z.failed, z.effectiveness])];
  } else if (sp.tab === "carga-quemada") {
    rows = [["Tipo", "Envío", "Cliente", "ID", "Registrado", "Compromiso", "Entregado", "Estado"],
      ...(await burnedReport(prisma, range)).map((b) => [KIND[b.kind], b.code, b.client, b.publicId, fecha(b.createdAt), fecha(b.promisedAt), fecha(b.deliveredAt), b.status])];
  } else {
    rows = [["Repartidor", "Entregas", "No entregados", "Efectividad %", "Días", "Promedio/día", "Horario extra", "23 h o después", "Min. carga→entrega"],
      ...(await driverReport(prisma, range)).map((d) => [d.name, d.delivered, d.failed, d.effectiveness, d.days, d.perDay, d.overtime, d.afterHours, d.avgMinutes])];
  }
  const csv = "﻿" + rows.map((r) => r.map(cell).join(",")).join("\r\n");
  return new Response(csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${sp.tab || "repartidores"}-${fromYmd}_${toYmd}.csv"` },
  });
}
