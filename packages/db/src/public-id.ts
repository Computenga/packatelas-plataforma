// ID público de cliente: cmx (CDMX) o emx (Estado de México) + número, con sufijo opcional de
// subcuenta: cmx00114, emx00126, cmx00127-granjas. Sin dependencias: también lo usa el navegador.

export const ID_PREFIXES = ["cmx", "emx"] as const;
export type IdPrefix = (typeof ID_PREFIXES)[number];
export const PUBLIC_ID = /^(cmx|emx)\d{3,6}(-[a-z0-9]+)*$/;

/** Normaliza: "CMX 114" → "cmx00114", "EMX00152-Tolsa" → "emx00152-tolsa". */
export function normalizePublicId(raw: string): string | null {
  const m = raw.trim().toLowerCase().replace(/\s+/g, "").match(/^(cmx|emx)-?0*(\d{1,6})((?:-[a-z0-9ñáéíóú]+)*)$/);
  if (!m) return null;
  const suffix = m[3].normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ñ/g, "n");
  const id = `${m[1]}${m[2].padStart(5, "0")}${suffix}`;
  return PUBLIC_ID.test(id) ? id : null;
}

/** Referencia de pago: el mismo ID en mayúsculas y sin guiones (lo que los clientes ya escriben). */
export function referenceFromPublicId(publicId: string): string {
  return publicId.toUpperCase().replace(/-/g, "").slice(0, 30);
}
