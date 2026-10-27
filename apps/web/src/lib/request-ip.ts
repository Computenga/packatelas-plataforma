import "server-only";

/**
 * IP real de quien llama. El proxy (Traefik) pone X-Real-Ip y AGREGA al final de
 * X-Forwarded-For; el primer valor de X-Forwarded-For lo puede inventar quien llama.
 */
export function ipFrom(h: Headers): string {
  return h.get("x-real-ip")?.trim() || (h.get("x-forwarded-for") ?? "").split(",").pop()?.trim() || "local";
}
