import { prisma } from "@packatelas/db";
import { getSessionUser } from "@/lib/session";
import { fetchWhatsappMedia } from "@/lib/wa-templates";

/** Archivo que mandó alguien por WhatsApp (solo administradores, y solo si está en la bandeja). */
export async function GET(_req: Request, ctx: RouteContext<"/api/whatsapp/media/[id]">) {
  const user = await getSessionUser();
  if (!user || user.role !== "ADMIN") return new Response("No autorizado", { status: 401 });
  const { id } = await ctx.params;
  if (!(await prisma.waMessage.findFirst({ where: { mediaId: id }, select: { id: true } }))) return new Response("No encontrado", { status: 404 });
  const f = await fetchWhatsappMedia(id);
  if (!f) return new Response("WhatsApp ya no tiene este archivo", { status: 404 });
  return new Response(f.data, { headers: { "Content-Type": f.mime, "Cache-Control": "private, max-age=86400" } });
}
