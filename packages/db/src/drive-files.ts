// Trae al servidor los archivos que la unificación [A37] dejó como liga a Google Drive:
// expedientes (fileKey "drive:<id>") y fotos de flotilla (URLs de Drive en checks, fallas y
// reparaciones). Así el portal deja de depender de Drive. Va por tandas; lo que Google no deja
// bajar (borrado, sin permiso, formato raro) se anota y se queda como liga.
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PrismaClient } from "../generated/prisma/client.ts";
import { googleAccessToken } from "./legacy-sync.ts";

type Fetch = typeof fetch;
const KEY = "legacy.drive_copy";
const MAX = 15 * 1024 * 1024;
type State = { copied: number; failed: Record<string, string>; at?: string; lastError?: string };

export async function getDriveCopyState(prisma: PrismaClient): Promise<State> {
  const v = (await prisma.setting.findUnique({ where: { key: KEY } }))?.value as Partial<State> | undefined;
  return { copied: v?.copied ?? 0, failed: v?.failed ?? {}, at: v?.at, lastError: v?.lastError };
}
const saveState = (prisma: PrismaClient, s: State) => prisma.setting.upsert({ where: { key: KEY }, create: { key: KEY, value: s }, update: { value: s } });

/** Id del archivo en una liga de Drive (/file/d/<id>/, ?id=<id>, open?id=). */
export function driveFileId(url: string): string | null {
  const m = /drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:[^#]*&)?id=)([\w-]{10,})/.exec(url) ?? /[?&]id=([\w-]{10,})/.exec(url);
  return m ? m[1] : null;
}

export function sniffFile(buf: Buffer): "jpg" | "png" | "webp" | "pdf" | null {
  if (buf.subarray(0, 5).toString() === "%PDF-") return "pdf";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (buf.subarray(0, 4).toString() === "RIFF" && buf.subarray(8, 12).toString() === "WEBP") return "webp";
  return null;
}
const MIME = { jpg: "image/jpeg", png: "image/png", webp: "image/webp", pdf: "application/pdf" } as const;

async function store(dir: string, prefix: "docs" | "fleet", buf: Buffer, ext: keyof typeof MIME) {
  const now = new Date();
  const key = `${prefix}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${randomUUID()}.${ext}`;
  const file = path.join(dir, key);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, buf);
  return key;
}

/** Una tanda. Devuelve cuántos copió y cuántos quedan por revisar. */
export async function copyDriveFiles(prisma: PrismaClient, opts: { uploadDir?: string; limit?: number; fetchImpl?: Fetch } = {}) {
  const dir = path.resolve(opts.uploadDir ?? process.env.UPLOAD_DIR ?? "./uploads");
  const fetchImpl = opts.fetchImpl ?? fetch;
  let budget = opts.limit ?? 40;
  const state = await getDriveCopyState(prisma);
  const skip = (id: string) => id in state.failed;

  const docs = (await prisma.employeeDocument.findMany({ where: { fileKey: { startsWith: "drive:" } }, select: { id: true, fileKey: true } })).filter((d) => !skip(d.fileKey.slice(6)));
  const fleetWhere = { photos: { isEmpty: false } } as const;
  const [checks, faults, repairs] = await Promise.all([
    prisma.vehicleCheck.findMany({ where: fleetWhere, select: { id: true, photos: true } }),
    prisma.fault.findMany({ where: fleetWhere, select: { id: true, photos: true } }),
    prisma.repair.findMany({ where: fleetWhere, select: { id: true, photos: true } }),
  ]);
  const hasPending = (photos: string[]) => photos.some((p) => /^https?:/.test(p) && driveFileId(p) && !skip(driveFileId(p)!));
  const fleet = [
    ...checks.filter((x) => hasPending(x.photos)).map((x) => ({ ...x, table: "vehicleCheck" as const })),
    ...faults.filter((x) => hasPending(x.photos)).map((x) => ({ ...x, table: "fault" as const })),
    ...repairs.filter((x) => hasPending(x.photos)).map((x) => ({ ...x, table: "repair" as const })),
  ];
  const pendingBefore = docs.length + fleet.reduce((n, x) => n + x.photos.filter((p) => /^https?:/.test(p)).length, 0);
  if (!pendingBefore) return { copied: 0, failed: 0, pending: 0 };

  const token = await googleAccessToken(prisma, fetchImpl);
  if (!token) return { copied: 0, failed: 0, pending: pendingBefore, error: "Google Drive no está conectado" };

  let copied = 0, failed = 0;
  /** Baja un archivo; null si no se pudo (queda anotado). Lanza si el permiso falta (para todo). */
  const download = async (id: string): Promise<{ buf: Buffer; ext: keyof typeof MIME } | null> => {
    const r = await fetchImpl(`https://www.googleapis.com/drive/v3/files/${id}?alt=media&supportsAllDrives=true`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(60_000) });
    if (r.status === 401 || (r.status === 403 && /insufficient|scope/i.test(await r.clone().text().catch(() => ""))))
      throw new Error("Falta permiso para leer archivos de Drive: en Salud vuelve a «Conectar Google Drive» y acepta todos los permisos.");
    const fail = (why: string) => { state.failed[id] = why.slice(0, 120); failed++; return null; };
    if (!r.ok) return fail(`Drive respondió ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > MAX) return fail("más de 15 MB");
    const ext = sniffFile(buf);
    if (!ext) return fail("formato no soportado (no es foto JPG/PNG/WEBP ni PDF)");
    return { buf, ext };
  };

  try {
    for (const d of docs) {
      if (budget <= 0) break;
      budget--;
      const got = await download(d.fileKey.slice(6));
      if (!got) continue;
      const key = await store(dir, "docs", got.buf, got.ext);
      await prisma.employeeDocument.update({ where: { id: d.id }, data: { fileKey: key, mime: MIME[got.ext] } });
      copied++;
    }
    for (const row of fleet) {
      if (budget <= 0) break;
      const next: string[] = [];
      let changed = false;
      for (const p of row.photos) {
        const id = /^https?:/.test(p) ? driveFileId(p) : null;
        if (!id || skip(id) || budget <= 0) { next.push(p); continue; }
        budget--;
        const got = await download(id);
        if (!got || got.ext === "pdf") { if (got) { state.failed[id] = "es PDF, no foto"; failed++; } next.push(p); continue; }
        next.push(await store(dir, "fleet", got.buf, got.ext));
        changed = true;
        copied++;
      }
      if (changed) {
        const data = { photos: next };
        if (row.table === "vehicleCheck") await prisma.vehicleCheck.update({ where: { id: row.id }, data });
        else if (row.table === "fault") await prisma.fault.update({ where: { id: row.id }, data });
        else await prisma.repair.update({ where: { id: row.id }, data });
      }
    }
    state.lastError = undefined;
  } catch (e) {
    state.lastError = e instanceof Error ? e.message : String(e);
  }
  state.copied += copied;
  state.at = new Date().toISOString();
  await saveState(prisma, state);
  return { copied, failed, pending: Math.max(0, pendingBefore - copied - failed), error: state.lastError };
}
