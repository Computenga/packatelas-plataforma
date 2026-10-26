import { getSessionUser } from "@/lib/session";

/** Plantilla CSV de migración de clientes [A21]. */
export async function GET() {
  const user = await getSessionUser();
  if (user?.role !== "ADMIN") return new Response("No autorizado", { status: 401 });
  const rows = [
    ["ID", "Nombre", "Contacto", "Teléfono", "Correo", "Tarifa", "Saldo", "Dirección de recolección", "RFC", "Razón social", "Régimen fiscal", "CP fiscal", "Uso CFDI", "Activo"],
    ["cmx00114", "Tienda Ejemplo", "Ana López", "5512345678", "ana@ejemplo.com", "75", "1500.00", "Lago Zurich 245, Ampliación Granada, 11529", "", "", "", "", "", "Sí"],
  ];
  const csv = "﻿" + rows.map((r) => r.map((c) => (/[",]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(",")).join("\r\n");
  return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="plantilla-clientes.csv"' } });
}
