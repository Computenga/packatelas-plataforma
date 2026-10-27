import { getDriverSession, unauthorized } from "@/lib/driver-api";
import { saveEvidence, sniffImage } from "@/lib/uploads";

const MAX_BYTES = 8 * 1024 * 1024;

/** Sube la foto de evidencia y devuelve su clave para adjuntarla al evento. */
export async function POST(request: Request) {
  const s = await getDriverSession();
  if (!s) return unauthorized();
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BYTES + 64 * 1024) return Response.json({ error: "La foto pesa más de 8 MB" }, { status: 413 });
  const form = await request.formData().catch(() => null);
  const file = form?.get("photo");
  if (!(file instanceof Blob)) return Response.json({ error: "Falta la foto" }, { status: 400 });
  if (file.size > MAX_BYTES) return Response.json({ error: "La foto pesa más de 8 MB" }, { status: 413 });
  const buf = Buffer.from(await file.arrayBuffer());
  const ext = sniffImage(buf);
  if (!ext) return Response.json({ error: "El archivo no es una imagen" }, { status: 415 });
  const key = await saveEvidence(buf, ext);
  return Response.json({ key });
}
