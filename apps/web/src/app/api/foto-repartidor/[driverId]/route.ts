import { prisma } from "@packatelas/db";
import { getSessionUser } from "@/lib/session";
import { STAFF_ROLES } from "@/lib/roles";
import { readEvidence } from "@/lib/uploads";

const TYPES: Record<string, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" };

/** Foto de perfil del repartidor: para el personal interno y para el propio repartidor. */
export async function GET(_req: Request, ctx: RouteContext<"/api/foto-repartidor/[driverId]">) {
  const user = await getSessionUser();
  if (!user) return new Response("No autorizado", { status: 401 });
  const { driverId } = await ctx.params;
  const d = await prisma.driver.findUnique({ where: { id: driverId }, select: { userId: true, photoKey: true } });
  if (!d?.photoKey) return new Response("Sin foto", { status: 404 });
  if (!STAFF_ROLES.includes(user.role) && d.userId !== user.id) return new Response("No autorizado", { status: 403 });
  const data = await readEvidence(d.photoKey);
  if (!data) return new Response("Sin foto", { status: 404 });
  return new Response(new Uint8Array(data), { headers: { "Content-Type": TYPES[d.photoKey.split(".").pop()!] ?? "image/jpeg", "Cache-Control": "private, max-age=300" } });
}
