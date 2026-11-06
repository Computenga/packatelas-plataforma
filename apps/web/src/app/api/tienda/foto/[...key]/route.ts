import { getSessionUser } from "@/lib/session";
import { readEvidence } from "@/lib/uploads";

const TYPES = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" } as const;

/** Fotos de los productos de la tienda de insumos (cualquier usuario con sesión). */
export async function GET(_req: Request, ctx: RouteContext<"/api/tienda/foto/[...key]">) {
  if (!(await getSessionUser())) return new Response("Inicia sesión", { status: 401 });
  const key = (await ctx.params).key.join("/");
  if (!key.startsWith("store/")) return new Response("No encontrado", { status: 404 });
  const data = await readEvidence(key);
  if (!data) return new Response("No encontrado", { status: 404 });
  const ext = key.split(".").pop() as keyof typeof TYPES;
  return new Response(new Uint8Array(data), { headers: { "Content-Type": TYPES[ext] ?? "application/octet-stream", "Cache-Control": "private, max-age=604800, immutable" } });
}
