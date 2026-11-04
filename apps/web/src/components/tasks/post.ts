"use client";

import { compressPhoto } from "@/lib/offline-queue";

/** Reduce las fotos (no PDF/Office) antes de subirlas: en el celular pesan 4–8 MB. */
export async function withCompressedPhotos(fd: FormData) {
  const files = fd.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  fd.delete("files");
  for (const f of files) {
    if (/^image\/(jpeg|png|webp|heic|heif)$/.test(f.type) && f.size > 600_000) {
      const b = await compressPhoto(f);
      fd.append("files", new File([b], f.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" }));
    } else fd.append("files", f);
  }
  return fd;
}

export async function postTask(url: string, fd: FormData): Promise<{ ok?: boolean; error?: string; url?: string; id?: string }> {
  const r = await fetch(url, { method: "POST", body: await withCompressedPhotos(fd) }).catch(() => null);
  if (!r) return { error: "Sin conexión. Intenta de nuevo." };
  return r.json().catch(() => ({ error: `Error ${r.status}` }));
}
