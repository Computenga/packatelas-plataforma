import "server-only";
import { saveEvidence, sniffImage } from "./uploads";

const MAX = 4 * 1024 * 1024;

/** Foto opcional de un mensaje de soporte: null si no hay, la clave si se guardó, o un error. */
export async function savePhotoFromForm(fd: FormData): Promise<{ key: string | null } | { error: string }> {
  const f = fd.get("photo");
  if (!(f instanceof Blob) || f.size === 0) return { key: null };
  if (f.size > MAX) return { error: "La foto pesa demasiado (máx. 4 MB)" };
  const buf = Buffer.from(await f.arrayBuffer());
  const ext = sniffImage(buf);
  if (!ext) return { error: "El archivo no es una imagen" };
  return { key: await saveEvidence(buf, ext, "support") };
}
