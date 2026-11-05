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
  const sp = new URL(request.url).searchParams;
  const f = readFilters(Object.fromEntries(sp));
  // ?ids=a,b,c: solo los seleccionados (siempre dentro de su propio cliente).
  const ids = (sp.get("ids") ?? "").split(",").filter(Boolean).slice(0, 500);
  const where = ids.length ? { id: { in: ids }, clientId: user.clientId } : buildWhere(f, user.clientId);
  const orders = await prisma.order.findMany({ where: { ...where, kind: "DELIVERY" }, orderBy: { createdAt: "desc" }, take: 50_000 });
  const lines = [["Registrado", "Envío", "Estado", "Destinatario", "Dirección", "Colonia", "CP", "Entregado", "Intentos"].map(cell).join(",")];
  for (const o of orders) {
    lines.push([fecha(o.createdAt), o.code, STATUS_LABEL[o.status], o.recipientName, o.addressLine, o.neighborhood, o.zip, fecha(o.deliveredAt), o.attempts].map(cell).join(","));
  }
  return new Response("﻿" + lines.join("\r\n"), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="envios-${new Date().toISOString().slice(0, 10)}.csv"` },
  });
}
