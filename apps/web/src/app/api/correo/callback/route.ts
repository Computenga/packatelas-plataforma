import { connectMail, prisma, readMailState } from "@packatelas/db";
import { getSessionUser } from "@/lib/session";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const base = process.env.PUBLIC_URL?.replace(/\/$/, "") || url.origin;
  const back = (msg: string, ok = false) => Response.redirect(`${base}/admin/salud?${new URLSearchParams({ [ok ? "driveok" : "drive"]: msg })}`, 303);
  const code = url.searchParams.get("code");
  const who = readMailState(url.searchParams.get("state") ?? "");
  if (!code) return back("Cancelaste la conexión del correo");
  const user = await getSessionUser();
  if (!who || !user || user.id !== who || user.role !== "ADMIN") return back("El enlace venció o lo abrió otro usuario. Vuelve a intentarlo desde Salud.");
  try {
    const r = await connectMail(prisma, code);
    return r.ok ? back(`Correo de envío conectado${r.email ? ` (${r.email})` : ""}: desde ahí salen los enlaces para restablecer contraseña.`, true) : back(r.error);
  } catch (e) {
    console.error("[correo] callback", e);
    return back("No se pudo conectar el correo. Intenta de nuevo.");
  }
}
