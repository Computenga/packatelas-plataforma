import { prisma } from "@packatelas/db";
import { getDriverSession, unauthorized } from "@/lib/driver-api";
import { deleteEvidence, saveEvidence, sniffImage } from "@/lib/uploads";

const MAX_BYTES = 5 * 1024 * 1024;

/** Foto de perfil del repartidor (se muestra a la tienda en el rastreo de su recolección). */
export async function POST(request: Request) {
  const s = await getDriverSession();
  if (!s) return unauthorized();
  const form = await request.formData().catch(() => null);
  const file = form?.get("photo");
  if (!(file instanceof Blob)) return Response.json({ error: "Falta la foto" }, { status: 400 });
  if (file.size > MAX_BYTES) return Response.json({ error: "La foto pesa más de 5 MB" }, { status: 413 });
  const buf = Buffer.from(await file.arrayBuffer());
  const ext = sniffImage(buf);
  if (!ext) return Response.json({ error: "El archivo no es una imagen" }, { status: 415 });
  const key = await saveEvidence(buf, ext, "profile");
  const prev = await prisma.driver.findUnique({ where: { id: s.driver.id }, select: { photoKey: true } });
  await prisma.driver.update({ where: { id: s.driver.id }, data: { photoKey: key } });
  if (prev?.photoKey) await deleteEvidence(prev.photoKey).catch(() => false);
  return Response.json({ ok: true });
}
