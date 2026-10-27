import "server-only";
import { ipFrom } from "./request-ip";

// Respuestas en texto plano como espera el firmware del ZKTeco.
export const text = (body: string, status = 200) =>
  new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });

/** IP real del reloj (ver ipFrom). */
export const clientIp = (r: Request) => {
  const ip = ipFrom(r.headers);
  return ip === "local" ? undefined : ip;
};

/** Lee el cuerpo con tope de tamaño sin cargarlo completo si viene enorme. */
export async function readCapped(r: Request, max: number): Promise<string | null> {
  if (Number(r.headers.get("content-length") ?? 0) > max) return null;
  if (!r.body) return "";
  const reader = r.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}
