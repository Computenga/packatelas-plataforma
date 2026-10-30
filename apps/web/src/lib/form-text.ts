/** Texto de un formulario de importación: el archivo subido (campo «file») o lo pegado (campo «text»). */
export async function formText(fd: FormData, max = 20_000_000) {
  const f = fd.get("file");
  if (f instanceof File && f.size > 0) {
    if (f.size > max) throw new Error("Archivo demasiado grande");
    return (await f.text()).replace(/^﻿/, "");
  }
  return String(fd.get("text") ?? "");
}
