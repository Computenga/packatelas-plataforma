import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { audit, prisma } from "@packatelas/db";
import { getSessionUser } from "@/lib/session";

const DIR = process.env.BACKUP_DIR ?? "/backups";
const NAME = /^packatelas-\d{4}-\d{2}-\d{2}\.dump$/;

/** Descarga del respaldo más reciente de la base [P08]. Solo administradores; queda en auditoría. */
export async function GET() {
  const user = await getSessionUser();
  if (user?.role !== "ADMIN") return new Response("No autorizado", { status: 401 });
  const name = (await readdir(DIR).catch(() => [] as string[])).filter((n) => NAME.test(n)).sort().at(-1);
  if (!name) return new Response("Aún no hay respaldos", { status: 404 });
  const file = path.join(DIR, name);
  const { size } = await stat(file);
  await audit(prisma, { actorUserId: user.id, action: "backup.downloaded", entity: "Backup", summary: `Descargó ${name}` }).catch(() => {});
  return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, {
    headers: { "Content-Type": "application/octet-stream", "Content-Length": String(size), "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" },
  });
}
