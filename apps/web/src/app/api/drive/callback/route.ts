import { connectDrive, prisma, readDriveState } from "@packatelas/db";
import { getSessionUser } from "@/lib/session";

/** Regreso de Google: guarda el permiso de Drive cifrado y vuelve a Salud. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const base = process.env.PUBLIC_URL?.replace(/\/$/, "") || url.origin;
  const back = (msg: string, ok = false) => Response.redirect(`${base}/admin/salud?${new URLSearchParams({ [ok ? "driveok" : "drive"]: msg })}`, 303);
  const code = url.searchParams.get("code");
  const who = readDriveState(url.searchParams.get("state") ?? "");
  if (!code) return back(url.searchParams.get("error") === "access_denied" ? "Cancelaste la autorización de Google Drive" : "Google no envió la autorización");
  const user = await getSessionUser();
  if (!who || !user || user.id !== who || user.role !== "ADMIN") return back("El enlace venció o lo abrió otro usuario. Vuelve a intentarlo desde Salud.");
  try {
    const r = await connectDrive(prisma, code, user.id);
    return r.ok ? back(`Google Drive conectado${r.email ? ` (${r.email})` : ""}. El primer respaldo se sube en la siguiente vuelta (máx. 30 min).`, true) : back(r.error);
  } catch (e) {
    console.error("[drive] callback", e);
    return back("No se pudo completar la conexión con Google Drive. Intenta de nuevo.");
  }
}
