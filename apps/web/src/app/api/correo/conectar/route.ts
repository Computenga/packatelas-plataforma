import { mailAuthUrl } from "@packatelas/db";
import { getSessionUser } from "@/lib/session";

/** Un admin conecta la cuenta de Google con la que salen los correos (restablecer contraseña). */
export async function GET(request: Request) {
  const user = await getSessionUser();
  const base = process.env.PUBLIC_URL?.replace(/\/$/, "") || new URL(request.url).origin;
  if (!user || user.role !== "ADMIN") return Response.redirect(`${base}/login`, 303);
  const url = mailAuthUrl(user.id);
  return Response.redirect(url ?? `${base}/admin/salud?drive=${encodeURIComponent("Falta configurar GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET o PUBLIC_URL")}`, 303);
}
