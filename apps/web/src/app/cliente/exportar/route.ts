import { prisma } from "@packatelas/db";
import { getSessionUser } from "@/lib/session";
import { fecha, STATUS_LABEL } from "@/lib/format";
import { buildWhere, readFilters } from "@/lib/order-filters";

const cell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/** CSV de los envíos del propio cliente [C03, I11]. */
export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user || user.role !== "CLIENTE" || !user.clientId) return new Response("No autorizado", { status: 401 });
  const f = readFilters(Object.fromEntries(new URL(request.url).searchParams));
  const orders = await prisma.order.findMany({ where: buildWhere(f, user.clientId), orderBy: { createdAt: "desc" }, take: 50_000 });
  const lines = [["Registrado", "Envío", "Estado", "Destinatario", "Dirección", "Colonia", "CP", "Entregado", "Intentos"].map(cell).join(",")];
  for (const o of orders) {
    lines.push([fecha(o.createdAt), o.code, STATUS_LABEL[o.status], o.recipientName, o.addressLine, o.neighborhood, o.zip, fecha(o.deliveredAt), o.attempts].map(cell).join(","));
  }
  return new Response("﻿" + lines.join("\r\n"), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="envios-${new Date().toISOString().slice(0, 10)}.csv"` },
  });
}
