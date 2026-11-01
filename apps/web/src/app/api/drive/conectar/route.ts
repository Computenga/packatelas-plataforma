import { driveAuthUrl } from "@packatelas/db";
import { getSessionUser } from "@/lib/session";

/** Manda al admin a Google para autorizar los respaldos en Drive. */
export async function GET(request: Request) {
  const user = await getSessionUser();
  const base = process.env.PUBLIC_URL?.replace(/\/$/, "") || new URL(request.url).origin;
  if (!user || user.role !== "ADMIN") return Response.redirect(`${base}/login`, 303);
  const url = driveAuthUrl(user.id);
  if (!url) return Response.redirect(`${base}/admin/salud?drive=${encodeURIComponent("Falta configurar GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET o PUBLIC_URL en el servidor")}`, 303);
  return Response.redirect(url, 303);
}
