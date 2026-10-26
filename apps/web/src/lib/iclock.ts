import "server-only";

// Respuestas en texto plano como espera el firmware del ZKTeco.
export const text = (body: string, status = 200) =>
  new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });

export const clientIp = (r: Request) => (r.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || undefined;
