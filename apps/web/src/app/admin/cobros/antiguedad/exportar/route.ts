import { AGING_BUCKETS, agingReport, prisma } from "@packatelas/db";
import { getSessionUser } from "@/lib/session";
import { soloFecha } from "@/lib/format";

const cell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export async function GET() {
  const user = await getSessionUser();
  if (user?.role !== "ADMIN") return new Response("No autorizado", { status: 401 });
  const rows = await agingReport(prisma);
  const clients = new Map((await prisma.client.findMany({ where: { id: { in: rows.map((r) => r.clientId) } }, select: { id: true, name: true, publicId: true, phone: true, creditMode: true } })).map((c) => [c.id, c]));
  const lines = [["Cliente", "ID", "Teléfono", "Forma de pago", ...AGING_BUCKETS.map((b) => b.label), "Total", "Cargo más antiguo sin pagar"].map(cell).join(",")];
  for (const r of rows) {
    const c = clients.get(r.clientId);
    lines.push([c?.name, c?.publicId, c?.phone, c?.creditMode === "WEEKLY_CREDIT" ? "Crédito semanal" : "Prepago", ...AGING_BUCKETS.map((b) => r.buckets[b.key].toFixed(2)), r.total.toFixed(2), soloFecha(r.oldest)].map(cell).join(","));
  }
  return new Response("﻿" + lines.join("\r\n"), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="antiguedad-saldos-${new Date().toISOString().slice(0, 10)}.csv"` },
  });
}
