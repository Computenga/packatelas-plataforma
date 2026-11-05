import { prisma } from "@packatelas/db";
import { orderIdFromToken } from "@/lib/tracking";
import { readEvidence } from "@/lib/uploads";

const TYPES: Record<string, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" };

/** Foto del repartidor (recolección activa o envío en camino), solo con el enlace de rastreo. */
export async function GET(_req: Request, ctx: RouteContext<"/s/[token]/foto">) {
  const id = orderIdFromToken((await ctx.params).token);
  if (!id) return new Response("No encontrado", { status: 404 });
  const o = await prisma.order.findUnique({ where: { id }, select: { kind: true, status: true, driver: { select: { photoKey: true } } } });
  if (!o || (o.kind === "PICKUP" ? !["ASSIGNED", "OUT_FOR_DELIVERY"].includes(o.status) : o.status !== "OUT_FOR_DELIVERY") || !o.driver?.photoKey) return new Response("No encontrado", { status: 404 });
  const data = await readEvidence(o.driver.photoKey);
  if (!data) return new Response("No encontrado", { status: 404 });
  return new Response(new Uint8Array(data), { headers: { "Content-Type": TYPES[o.driver.photoKey.split(".").pop()!] ?? "image/jpeg", "Cache-Control": "public, max-age=300" } });
}
