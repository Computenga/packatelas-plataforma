import { prisma } from "@packatelas/db";
import { getSessionUser } from "@/lib/session";
import { STAFF_ROLES } from "@/lib/roles";
import { readEvidence } from "@/lib/uploads";

const TYPES = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" } as const;

/** Foto de un reporte de soporte: solo el equipo o la tienda dueña (y nunca de una nota interna). */
export async function GET(_req: Request, ctx: RouteContext<"/api/soporte/adjunto/[...key]">) {
  const user = await getSessionUser();
  if (!user) return new Response("No autorizado", { status: 401 });
  const key = (await ctx.params).key.join("/");
  const msg = await prisma.ticketMessage.findFirst({ where: { attachmentKey: key }, select: { internal: true, ticket: { select: { clientId: true } } } });
  if (!msg) return new Response("No encontrado", { status: 404 });
  const allowed = STAFF_ROLES.includes(user.role) || (user.role === "CLIENTE" && user.clientId === msg.ticket.clientId && !msg.internal);
  if (!allowed) return new Response("No autorizado", { status: 403 });
  const data = await readEvidence(key);
  if (!data) return new Response("No encontrado", { status: 404 });
  const ext = key.split(".").pop() as keyof typeof TYPES;
  return new Response(new Uint8Array(data), { headers: { "Content-Type": TYPES[ext] ?? "application/octet-stream", "Cache-Control": "private, max-age=86400" } });
}
