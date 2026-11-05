import { cookies } from "next/headers";
import { prisma } from "@packatelas/db";
import { buyerCookieName, buyerVerified, orderIdFromToken } from "@/lib/tracking";
import { readEvidence } from "@/lib/uploads";

/** Foto de entrega para el comprador, solo si confirmó los últimos 4 dígitos de su teléfono. */
export async function GET(_req: Request, ctx: RouteContext<"/s/[token]/evidencia">) {
  const id = orderIdFromToken((await ctx.params).token);
  if (!id || !buyerVerified(id, (await cookies()).get(buyerCookieName(id))?.value)) return new Response("No autorizado", { status: 403 });
  const ev = await prisma.evidence.findFirst({ where: { orderId: id, kind: "PHOTO" }, orderBy: { createdAt: "desc" }, select: { storageKey: true } });
  const data = ev ? await readEvidence(ev.storageKey) : null;
  if (!data) return new Response("Sin foto", { status: 404 });
  return new Response(new Uint8Array(data), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=600" } });
}
