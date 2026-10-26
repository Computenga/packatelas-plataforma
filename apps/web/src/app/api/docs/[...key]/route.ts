import { prisma } from "@packatelas/db";
import { getSessionUser } from "@/lib/session";
import { readEvidence } from "@/lib/uploads";

const TYPES = { jpg: "image/jpeg", png: "image/png", webp: "image/webp", pdf: "application/pdf" } as const;

/** Documentos de expediente: solo administradores o el propio empleado. */
export async function GET(_req: Request, ctx: RouteContext<"/api/docs/[...key]">) {
  const user = await getSessionUser();
  if (!user) return new Response("No autorizado", { status: 401 });
  const key = (await ctx.params).key.join("/");
  const doc = await prisma.employeeDocument.findFirst({ where: { fileKey: key }, select: { employee: { select: { userId: true } } } });
  if (!doc) return new Response("No encontrado", { status: 404 });
  if (user.role !== "ADMIN" && doc.employee?.userId !== user.id) return new Response("No autorizado", { status: 403 });
  const data = await readEvidence(key);
  if (!data) return new Response("No encontrado", { status: 404 });
  const ext = key.split(".").pop() as keyof typeof TYPES;
  return new Response(new Uint8Array(data), {
    headers: { "Content-Type": TYPES[ext] ?? "application/octet-stream", "Cache-Control": "private, no-store", "Content-Disposition": "inline", "X-Content-Type-Options": "nosniff" },
  });
}
