import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { TaskFileInput } from "@packatelas/db";

// Archivos de tareas [A40]: fotos, PDF y documentos de Office. Se guardan en el volumen del servidor.
const root = () => path.resolve(/* turbopackIgnore: true */ process.env.UPLOAD_DIR || "./uploads");
const KEY = /^tasks\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.(jpg|png|webp|pdf|docx|xlsx|pptx)$/;
export const TASK_MAX_FILE = 10 * 1024 * 1024;
export const TASK_MAX_FILES = 6;
export const TASK_MIME = {
  jpg: "image/jpeg", png: "image/png", webp: "image/webp", pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
} as const;
type Ext = keyof typeof TASK_MIME;

/** Tipo real por la firma del archivo (Office = ZIP + la extensión del nombre). */
function sniff(buf: Buffer, name: string): Ext | null {
  if (buf.subarray(0, 5).toString() === "%PDF-") return "pdf";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (buf.subarray(0, 4).toString() === "RIFF" && buf.subarray(8, 12).toString() === "WEBP") return "webp";
  if (buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) {
    const ext = name.toLowerCase().split(".").pop();
    if (ext === "docx" || ext === "xlsx" || ext === "pptx") return ext;
  }
  return null;
}

/** Guarda los archivos del formulario (campo "files"). Si uno no sirve, no se guarda ninguno. */
export async function saveTaskFiles(form: FormData): Promise<{ files: TaskFileInput[] } | { error: string }> {
  const list = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (list.length > TASK_MAX_FILES) return { error: `Máximo ${TASK_MAX_FILES} archivos a la vez` };
  const ready: { buf: Buffer; ext: Ext; name: string }[] = [];
  for (const f of list) {
    if (f.size > TASK_MAX_FILE) return { error: `«${f.name}» pesa más de 10 MB` };
    const buf = Buffer.from(await f.arrayBuffer());
    const ext = sniff(buf, f.name);
    if (!ext) return { error: `«${f.name}»: sube fotos (JPG, PNG), PDF o archivos de Word, Excel o PowerPoint` };
    ready.push({ buf, ext, name: f.name || `archivo.${ext}` });
  }
  const now = new Date();
  const files: TaskFileInput[] = [];
  for (const r of ready) {
    const key = `tasks/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${randomUUID()}.${r.ext}`;
    const file = path.join(root(), key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, r.buf);
    files.push({ key, fileName: r.name.replace(/[\r\n"]/g, "").slice(0, 200), mime: TASK_MIME[r.ext], size: r.buf.length });
  }
  return { files };
}

export async function readTaskFile(key: string) {
  if (!KEY.test(key)) return null;
  return readFile(/* turbopackIgnore: true */ path.join(root(), key)).catch(() => null);
}

export async function removeTaskFiles(files: TaskFileInput[]) {
  for (const f of files) if (KEY.test(f.key)) await unlink(path.join(root(), f.key)).catch(() => {});
}
