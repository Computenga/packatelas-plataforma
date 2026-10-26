import { getSessionUser } from "@/lib/session";
import { readEvidence } from "@/lib/uploads";

const TYPES = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" } as const;

/** Sirve fotos de la flotilla a personal interno, mecánico y repartidores. */
export async function GET(_req: Request, ctx: RouteContext<"/api/fleet/photo/[...key]">) {
  const user = await getSessionUser();
  if (!user || user.role === "CLIENTE") return new Response("No autorizado", { status: 401 });
  const key = (await ctx.params).key.join("/");
  if (!key.startsWith("fleet/")) return new Response("No encontrado", { status: 404 });
  const data = await readEvidence(key);
  if (!data) return new Response("No encontrado", { status: 404 });
  const ext = key.split(".").pop() as keyof typeof TYPES;
  return new Response(new Uint8Array(data), { headers: { "Content-Type": TYPES[ext] ?? "application/octet-stream", "Cache-Control": "private, max-age=86400" } });
}
