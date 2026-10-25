import { prisma } from "@packatelas/db";
import { getSessionUser } from "@/lib/session";
import { STAFF_ROLES } from "@/lib/roles";
import { fecha, STATUS_LABEL } from "@/lib/format";
import { buildWhere, readFilters } from "@/lib/order-filters";

const MAX_ROWS = 50_000;

const cell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  // Evita inyección de fórmulas al abrir en Excel/Sheets.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/** Exporta los pedidos filtrados a CSV [A09, I11]. */
export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user || !STAFF_ROLES.includes(user.role)) return new Response("No autorizado", { status: 401 });

  const f = readFilters(Object.fromEntries(new URL(request.url).searchParams));
  const orders = await prisma.order.findMany({
    where: buildWhere(f),
    orderBy: { createdAt: "desc" },
    take: MAX_ROWS,
    include: {
      client: { select: { name: true, publicId: true } },
      branch: { select: { name: true } },
      driver: { include: { user: { select: { name: true } } } },
    },
  });

  const head = [
    "Registrado", "Código", "Envío ML", "Origen", "Estado", "Cliente", "ID cliente", "Sucursal",
    "Destinatario", "Teléfono", "Dirección", "Colonia", "Ciudad", "Estado (dirección)", "CP",
    "Latitud", "Longitud", "Repartidor", "Intentos", "Entregado",
  ];
  const lines = [head.map(cell).join(",")];
  for (const o of orders) {
    lines.push(
      [
        fecha(o.createdAt), o.code, o.mlShipmentId?.toString(), o.source, STATUS_LABEL[o.status], o.client.name,
        o.client.publicId, o.branch?.name, o.recipientName, o.recipientPhone, o.addressLine, o.neighborhood, o.city,
        o.state, o.zip, o.lat, o.lng, o.driver?.user.name, o.attempts, fecha(o.deliveredAt),
      ].map(cell).join(","),
    );
  }
  const stamp = new Date().toISOString().slice(0, 10);
  // BOM para que Excel lea bien los acentos.
  return new Response("﻿" + lines.join("\r\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="pedidos-${stamp}.csv"`,
    },
  });
}
