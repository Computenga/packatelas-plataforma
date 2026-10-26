import "server-only";
import { MIME, saveEvidence, sniffDoc } from "./uploads";

const MAX = 10 * 1024 * 1024;

/** Lee y guarda un documento (imagen o PDF) del formulario; error legible si no sirve. */
export async function readDocUpload(request: Request): Promise<{ key: string; mime: string; fileName: string; docType: string; form: FormData } | { error: string; status: number }> {
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const docType = String(form?.get("docType") ?? "");
  if (!(file instanceof Blob)) return { error: "Falta el archivo", status: 400 };
  if (!/^[a-z0-9_]{2,40}$/.test(docType)) return { error: "Tipo de documento inválido", status: 400 };
  if (file.size > MAX) return { error: "El archivo pesa más de 10 MB", status: 413 };
  const buf = Buffer.from(await file.arrayBuffer());
  const ext = sniffDoc(buf);
  if (!ext) return { error: "Sube una foto (JPG/PNG) o un PDF", status: 415 };
  const key = await saveEvidence(buf, ext, "docs");
  return { key, mime: MIME[ext], fileName: (file as File).name ?? `documento.${ext}`, docType, form: form! };
}
