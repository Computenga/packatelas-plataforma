import "server-only";
import { deleteEvidence, MIME, saveEvidence, sniffDoc } from "./uploads";

const MAX = 10 * 1024 * 1024;

export type DocUpload = { buf: Buffer; ext: "jpg" | "png" | "webp" | "pdf"; mime: string; fileName: string; docType: string; form: FormData };

/**
 * Lee un documento (imagen o PDF) del formulario SIN guardarlo: quien llama valida tipo y cupos
 * y luego llama a saveDocUpload. Rechaza por tamaño antes de leer el cuerpo.
 */
export async function readDocUpload(request: Request): Promise<DocUpload | { error: string; status: number }> {
  const len = Number(request.headers.get("content-length") ?? 0);
  if (len > MAX + 64 * 1024) return { error: "El archivo pesa más de 10 MB", status: 413 };
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const docType = String(form?.get("docType") ?? "");
  if (!(file instanceof Blob)) return { error: "Falta el archivo", status: 400 };
  if (!/^[a-z0-9_]{2,40}$/.test(docType)) return { error: "Tipo de documento inválido", status: 400 };
  if (file.size > MAX) return { error: "El archivo pesa más de 10 MB", status: 413 };
  const buf = Buffer.from(await file.arrayBuffer());
  const ext = sniffDoc(buf);
  if (!ext) return { error: "Sube una foto (JPG/PNG) o un PDF", status: 415 };
  return { buf, ext, mime: MIME[ext], fileName: (file as File).name ?? `documento.${ext}`, docType, form: form! };
}

export const saveDocUpload = (up: DocUpload) => saveEvidence(up.buf, up.ext, "docs");

export async function removeFiles(keys: string[]) {
  for (const k of keys) await deleteEvidence(k);
}
