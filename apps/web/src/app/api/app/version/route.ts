import { APK_PATH, APP_RELEASE } from "@/lib/app-release";

/** Versión vigente de la app Android (pública: la consulta la app antes de iniciar sesión). */
export function GET() {
  return Response.json({ ...APP_RELEASE, url: APK_PATH }, { headers: { "Cache-Control": "public, max-age=300" } });
}
