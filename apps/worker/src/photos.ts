// Fotos de evidencia de más de 90 días: se re-comprimen (máx. 960 px, calidad 60) para ocupar
// menos disco. Siguen siendo prueba de entrega legible; nunca se borran.
import { readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { prisma } from "@packatelas/db";

const DIR = process.env.UPLOAD_DIR ?? "/data/uploads";
const KEY = /^(evidence|fleet)\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.(jpg|png|webp)$/;
const CURSOR = "cleanup.photos";
const MIN_BYTES = 120 * 1024;

export async function shrinkOne(file: string): Promise<number> {
  const before = (await stat(file)).size;
  if (before < MIN_BYTES) return 0;
  const out = await sharp(await readFile(file)).rotate().resize({ width: 960, height: 960, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 60, mozjpeg: true }).toBuffer();
  if (out.length >= before) return 0;
  // Escritura atómica: primero a un temporal y luego se reemplaza.
  await writeFile(`${file}.tmp`, out);
  await rename(`${file}.tmp`, file);
  return before - out.length;
}

/** Procesa por lotes desde donde se quedó la vez anterior. Devuelve bytes ahorrados. */
export async function shrinkOldPhotos(limit = 500, now = new Date()) {
  const cutoff = new Date(now.getTime() - 90 * 86400_000);
  const row = await prisma.setting.findUnique({ where: { key: CURSOR } });
  const since = new Date((row?.value as { until?: string } | null)?.until ?? 0);
  const batch = await prisma.evidence.findMany({
    where: { kind: "PHOTO", createdAt: { gt: since, lt: cutoff } },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: { storageKey: true, createdAt: true },
  });
  let saved = 0, done = 0;
  for (const e of batch) {
    if (!KEY.test(e.storageKey)) continue;
    try {
      saved += await shrinkOne(path.join(DIR, e.storageKey));
      done++;
    } catch {
      // archivo faltante o dañado: se salta
    }
  }
  if (batch.length) {
    const until = batch[batch.length - 1].createdAt.toISOString();
    await prisma.setting.upsert({ where: { key: CURSOR }, update: { value: { until } }, create: { key: CURSOR, value: { until } } });
  }
  return { fotos: done, ahorroMB: Math.round((saved / 1048576) * 10) / 10 };
}
