import { prisma, taskFileFor } from "@packatelas/db";
import { getSessionUser } from "@/lib/session";
import { readTaskFile } from "@/lib/task-upload";

/** Archivo de una tarea: solo quien la asignó y quien la tiene. */
export async function GET(_req: Request, ctx: RouteContext<"/api/tareas/archivo/[...key]">) {
  const user = await getSessionUser();
  if (!user) return new Response("No autorizado", { status: 401 });
  const key = (await ctx.params).key.join("/");
  const meta = await taskFileFor(prisma, key, user.id);
  if (!meta) return new Response("No encontrado", { status: 404 });
  const data = await readTaskFile(key);
  if (!data) return new Response("No encontrado", { status: 404 });
  const inline = /^image\/|^application\/pdf$/.test(meta.mime);
  const name = encodeURIComponent(meta.fileName);
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": meta.mime, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${name}`,
    },
  });
}
