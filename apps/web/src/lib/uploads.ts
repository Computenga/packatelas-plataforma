import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

// Fotos de evidencia en disco (volumen del servidor). Cambiar a Object Storage solo toca este archivo.
const root = () => path.resolve(/* turbopackIgnore: true */ process.env.UPLOAD_DIR || "./uploads");
const KEY = /^(evidence|fleet|docs)\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.(jpg|png|webp|pdf)$/;

export async function saveEvidence(data: Buffer, ext: "jpg" | "png" | "webp" | "pdf", prefix: "evidence" | "fleet" | "docs" = "evidence"): Promise<string> {
  const now = new Date();
  const key = `${prefix}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${randomUUID()}.${ext}`;
  const file = path.join(root(), key);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, data);
  return key;
}

export async function readEvidence(key: string): Promise<Buffer | null> {
  if (!KEY.test(key)) return null;
  try {
    return await readFile(/* turbopackIgnore: true */ path.join(root(), key));
  } catch {
    return null;
  }
}

/** Revisa la firma del archivo para no confiar en el tipo que declara el navegador. */
export function sniffImage(buf: Buffer): "jpg" | "png" | "webp" | null {
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (buf.subarray(0, 4).toString() === "RIFF" && buf.subarray(8, 12).toString() === "WEBP") return "webp";
  return null;
}

/** Imagen o PDF (documentos de expediente). */
export function sniffDoc(buf: Buffer): "jpg" | "png" | "webp" | "pdf" | null {
  if (buf.subarray(0, 5).toString() === "%PDF-") return "pdf";
  return sniffImage(buf);
}
export const MIME = { jpg: "image/jpeg", png: "image/png", webp: "image/webp", pdf: "application/pdf" } as const;

/** Borra un archivo de evidencia (solo llaves válidas; si no existe, no pasa nada). */
export async function deleteEvidence(key: string): Promise<boolean> {
  if (!KEY.test(key)) return false;
  try {
    await unlink(/* turbopackIgnore: true */ path.join(root(), key));
    return true;
  } catch {
    return false;
  }
}
