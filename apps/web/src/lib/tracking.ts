import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

// Enlace público de seguimiento para el comprador [C12]: /s/<id>.<firma>. La firma evita que
// alguien adivine enlaces de otros pedidos; no se guarda nada en la base.
function sig(orderId: string) {
  const k = process.env.ENCRYPTION_KEY?.trim();
  if (!k) throw new Error("Falta ENCRYPTION_KEY");
  return createHmac("sha256", `track:${k}`).update(orderId).digest("base64url").slice(0, 16);
}

export const trackingPath = (orderId: string) => `/s/${orderId}.${sig(orderId)}`;

export function orderIdFromToken(token: string): string | null {
  const [id, s] = decodeURIComponent(token).split(".");
  if (!id || !s || !/^[a-z0-9]{20,40}$/.test(id)) return null;
  const a = Buffer.from(sig(id));
  const b = Buffer.from(s);
  return a.length === b.length && timingSafeEqual(a, b) ? id : null;
}

/** Enlace completo de seguimiento (para WhatsApp). */
export const publicTrackingUrl = (orderId: string) => `${(process.env.PUBLIC_URL ?? "https://nuevo.packatelas.mx").replace(/\/$/, "")}${trackingPath(orderId)}`;
