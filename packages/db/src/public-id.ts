// ID público de cliente (cmx00114, cmx00127-granjas). Sin dependencias: también lo usa el navegador.

export const PUBLIC_ID = /^cmx\d{3,6}(-[a-z0-9]+)*$/;

/** Normaliza un ID público: "CMX 114" → "cmx00114", "CMX00127-Granjas" → "cmx00127-granjas". */
export function normalizePublicId(raw: string): string | null {
  const m = raw.trim().toLowerCase().replace(/\s+/g, "").match(/^cmx-?0*(\d{1,6})((?:-[a-z0-9ñáéíóú]+)*)$/);
  if (!m) return null;
  const suffix = m[2].normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ñ/g, "n");
  const id = `cmx${m[1].padStart(5, "0")}${suffix}`;
  return PUBLIC_ID.test(id) ? id : null;
}
