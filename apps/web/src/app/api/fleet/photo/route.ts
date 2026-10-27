import { getSessionUser } from "@/lib/session";
import { saveEvidence, sniffImage } from "@/lib/uploads";

const MAX_BYTES = 8 * 1024 * 1024;
const ROLES = ["ADMIN", "MECANICO", "REPARTIDOR"];

/** Fotos de la flotilla (checks, fallas, reparaciones, documentos) [A24]. */
export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user || !ROLES.includes(user.role)) return Response.json({ error: "No autorizado" }, { status: 401 });
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BYTES + 64 * 1024) return Response.json({ error: "La foto pesa más de 8 MB" }, { status: 413 });
  const form = await request.formData().catch(() => null);
  const file = form?.get("photo");
  if (!(file instanceof Blob)) return Response.json({ error: "Falta la foto" }, { status: 400 });
  if (file.size > MAX_BYTES) return Response.json({ error: "La foto pesa más de 8 MB" }, { status: 413 });
  const buf = Buffer.from(await file.arrayBuffer());
  const ext = sniffImage(buf);
  if (!ext) return Response.json({ error: "El archivo no es una imagen" }, { status: 415 });
  return Response.json({ key: await saveEvidence(buf, ext, "fleet") });
}
