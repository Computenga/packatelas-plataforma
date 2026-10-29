import { invoiceFile, prisma } from "@packatelas/db";
import { getSessionUser } from "@/lib/session";
import { STAFF_ROLES } from "@/lib/roles";

/** PDF o XML de una factura. Personal: cualquiera; cliente: solo las suyas. */
export async function GET(_: Request, ctx: { params: Promise<{ id: string; tipo: string }> }) {
  const user = await getSessionUser();
  if (!user) return new Response("Inicia sesión", { status: 401 });
  const { id, tipo } = await ctx.params;
  if (tipo !== "pdf" && tipo !== "xml") return new Response("No encontrado", { status: 404 });
  const inv = await prisma.invoice.findUnique({ where: { id }, select: { clientId: true, providerUid: true } });
  const staff = (STAFF_ROLES as readonly string[]).includes(user.role);
  if (!inv || (!staff && !(user.role === "CLIENTE" && user.clientId === inv.clientId))) return new Response("No encontrado", { status: 404 });
  try {
    const f = await invoiceFile(prisma, id, tipo);
    return new Response(new Uint8Array(f.bytes), { headers: { "Content-Type": f.contentType, "Content-Disposition": `${tipo === "pdf" ? "inline" : "attachment"}; filename="${f.filename}"`, "Cache-Control": "private, max-age=3600" } });
  } catch (e) {
    return new Response(e instanceof Error ? e.message : "No se pudo descargar", { status: 502 });
  }
}
