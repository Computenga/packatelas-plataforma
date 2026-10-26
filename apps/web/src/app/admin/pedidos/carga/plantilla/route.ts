import { getSessionUser } from "@/lib/session";
import { TEMPLATE_HEADERS } from "@/lib/bulk-import";

/** Plantilla CSV para la carga masiva [A03]. */
export async function GET() {
  const user = await getSessionUser();
  if (!user || !["ADMIN", "OPERADOR"].includes(user.role)) return new Response("No autorizado", { status: 401 });
  const example = ["Ana López", "5512345678", "Lago Zurich 245", "Ampliación Granada", "11529", "Miguel Hidalgo", "CDMX", "Torre B, depto 1203", "Audífonos"];
  const csv = "﻿" + [TEMPLATE_HEADERS, example].map((r) => r.map((c) => (/[",]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(",")).join("\r\n");
  return new Response(csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="plantilla-pedidos.csv"' },
  });
}
