import "server-only";
import { authenticateApiKey, prisma, STATUS_TEXT, type OrderStatus } from "@packatelas/db";
import { trackingPath } from "./tracking";

// Utilidades de la API pública v1 para clientes [I08].

const hits = new Map<string, { n: number; until: number }>();
const LIMIT = 120; // solicitudes por minuto por llave

export async function apiAuth(request: Request) {
  const h = request.headers.get("authorization") ?? "";
  const raw = h.startsWith("Bearer ") ? h.slice(7).trim() : null;
  const auth = await authenticateApiKey(prisma, raw);
  if (!auth) return { error: apiError(401, "no_autorizado", "Llave de API inválida o revocada") };
  const now = Date.now();
  const w = hits.get(auth.keyId);
  if (!w || w.until < now) hits.set(auth.keyId, { n: 1, until: now + 60_000 });
  else if (++w.n > LIMIT) return { error: apiError(429, "demasiadas_solicitudes", "Máximo 120 solicitudes por minuto") };
  return { auth };
}

export function apiError(status: number, code: string, message: string, extra?: object) {
  return Response.json({ error: { codigo: code, mensaje: message, ...extra } }, { status });
}

const base = () => (process.env.PUBLIC_URL ?? "").replace(/\/$/, "");

type OrderRow = {
  id: string; code: string; externalRef: string | null; status: OrderStatus; createdAt: Date; deliveredAt: Date | null; attempts: number;
  recipientName: string | null; recipientPhone: string | null; addressLine: string | null; neighborhood: string | null; city: string | null;
  state: string | null; zip: string | null; lat: number | null; lng: number | null; instructions: string | null; itemsSummary: string | null;
  source: string;
};

export function orderView(o: OrderRow) {
  return {
    codigo: o.code,
    referencia: o.externalRef,
    origen: o.source,
    estado: o.status,
    estado_texto: STATUS_TEXT[o.status],
    intentos: o.attempts,
    creado: o.createdAt.toISOString(),
    entregado: o.deliveredAt?.toISOString() ?? null,
    destinatario: { nombre: o.recipientName, telefono: o.recipientPhone },
    direccion: { calle: o.addressLine, colonia: o.neighborhood, ciudad: o.city, estado: o.state, cp: o.zip, lat: o.lat, lng: o.lng, indicaciones: o.instructions },
    contenido: o.itemsSummary,
    seguimiento_url: `${base()}${trackingPath(o.id)}`,
  };
}
