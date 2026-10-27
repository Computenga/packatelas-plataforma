import { mkdtemp, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { shrinkOne } from "./photos.ts";

describe("fotos antiguas", () => {
  it("re-comprime una foto grande y deja una legible más chica", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "fotos-"));
    const file = path.join(dir, "f.jpg");
    // Ruido para que la foto pese como una real.
    const raw = Buffer.alloc(1600 * 1200 * 3);
    for (let i = 0; i < raw.length; i++) raw[i] = (i * 2654435761) >>> 24;
    await writeFile(file, await sharp(raw, { raw: { width: 1600, height: 1200, channels: 3 } }).jpeg({ quality: 90 }).toBuffer());
    const before = (await stat(file)).size;
    const saved = await shrinkOne(file);
    const after = await stat(file);
    expect(saved).toBeGreaterThan(0);
    expect(after.size).toBe(before - saved);
    const meta = await sharp(file).metadata();
    expect(Math.max(meta.width!, meta.height!)).toBe(960);
    expect(await shrinkOne(file)).toBe(0); // ya chica: no se toca
  });
});
