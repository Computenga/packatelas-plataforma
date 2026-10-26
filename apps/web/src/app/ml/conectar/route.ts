import { mlAuthUrl, readMlState } from "@packatelas/db";

/** Enlace corto para compartir: /ml/conectar?s=<estado firmado> → pantalla de autorización de MercadoLibre. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const base = process.env.PUBLIC_URL?.replace(/\/$/, "") || url.origin;
  const s = url.searchParams.get("s") ?? "";
  if (!readMlState(s)) return Response.redirect(`${base}/ml/conectado?error=${encodeURIComponent("El enlace venció o no es válido; pide uno nuevo a Packatelas")}`, 303);
  const auth = mlAuthUrl({ state: s });
  if (!auth) return Response.redirect(`${base}/ml/conectado?error=${encodeURIComponent("La conexión con MercadoLibre aún no está configurada")}`, 303);
  return Response.redirect(auth, 302);
}
