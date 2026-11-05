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
export const publicTrackingUrl = (orderId: string) => `${(process.env.PUBLIC_URL ?? "https://portal.packatelas.mx").replace(/\/$/, "")}${trackingPath(orderId)}`;

// Comprador verificado (últimos 4 dígitos del teléfono): cookie firmada por envío, 24 h.
const BUYER_TTL_MS = 24 * 3600_000;
const buyerSig = (orderId: string, exp: number) => createHmac("sha256", `buyer:${process.env.ENCRYPTION_KEY?.trim()}`).update(`${orderId}.${exp}`).digest("base64url").slice(0, 22);
export const buyerCookieName = (orderId: string) => `pk_bv_${orderId.slice(-10)}`;
export function buyerCookieValue(orderId: string, now = Date.now()) {
  const exp = now + BUYER_TTL_MS;
  return { value: `${exp}.${buyerSig(orderId, exp)}`, maxAge: BUYER_TTL_MS / 1000 };
}
export function buyerVerified(orderId: string, value: string | undefined, now = Date.now()) {
  const [expS, s] = (value ?? "").split(".");
  const exp = Number(expS);
  if (!exp || exp < now || !s) return false;
  const a = Buffer.from(buyerSig(orderId, exp));
  const b = Buffer.from(s);
  return a.length === b.length && timingSafeEqual(a, b);
}
