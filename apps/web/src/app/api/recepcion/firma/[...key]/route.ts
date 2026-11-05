import { getSessionUser } from "@/lib/session";
import { STAFF_ROLES } from "@/lib/roles";
import { readEvidence } from "@/lib/uploads";

/** Firma de recepción: solo personal interno. */
export async function GET(_req: Request, ctx: RouteContext<"/api/recepcion/firma/[...key]">) {
  const user = await getSessionUser();
  if (!user || !STAFF_ROLES.includes(user.role)) return new Response("No autorizado", { status: 401 });
  const key = (await ctx.params).key.join("/");
  if (!key.startsWith("gate/")) return new Response("No encontrado", { status: 404 });
  const data = await readEvidence(key);
  if (!data) return new Response("No encontrado", { status: 404 });
  return new Response(new Uint8Array(data), { headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=3600" } });
}
