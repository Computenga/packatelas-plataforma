// Carga masiva de pedidos [A03]: lee lo pegado desde Excel/Sheets o un CSV y lo valida.
// Sin dependencias de servidor para poder probarlo y usarlo en el navegador.

export type ImportField =
  | "recipientName" | "recipientPhone" | "addressLine" | "neighborhood" | "city" | "state" | "zip"
  | "instructions" | "itemsSummary" | "lat" | "lng";

export const FIELD_LABEL: Record<ImportField, string> = {
  recipientName: "Destinatario",
  recipientPhone: "Teléfono",
  addressLine: "Calle y número",
  neighborhood: "Colonia",
  city: "Alcaldía / municipio",
  state: "Estado",
  zip: "CP",
  instructions: "Referencias",
  itemsSummary: "Contenido",
  lat: "Latitud",
  lng: "Longitud",
};

/** Encabezados que reconocemos (sin acentos, minúsculas). */
const ALIASES: Record<ImportField, string[]> = {
  recipientName: ["destinatario", "nombre", "recibe", "cliente final", "nombre destinatario", "contacto"],
  recipientPhone: ["telefono", "tel", "celular", "cel", "whatsapp", "telefono destinatario"],
  addressLine: ["direccion", "calle", "calle y numero", "domicilio", "address"],
  neighborhood: ["colonia", "col", "barrio"],
  city: ["ciudad", "municipio", "alcaldia", "delegacion", "alcaldia / municipio", "alcaldia/municipio"],
  state: ["estado", "entidad"],
  zip: ["cp", "c.p.", "codigo postal", "c p", "zip"],
  instructions: ["referencias", "referencia", "notas", "instrucciones", "indicaciones", "comentarios"],
  itemsSummary: ["contenido", "producto", "productos", "articulo", "descripcion"],
  lat: ["lat", "latitud", "latitude"],
  lng: ["lng", "lon", "long", "longitud", "longitude"],
};

const norm = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

function detectDelimiter(firstLine: string): string {
  const counts = ["\t", ";", ","].map((d) => [d, firstLine.split(d).length - 1] as const);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ",";
}

/** CSV/TSV con comillas ("a, b" y "" dentro de comillas). */
export function parseTable(text: string): string[][] {
  const src = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const firstLine = src.split("\n", 1)[0] ?? "";
  const d = detectDelimiter(firstLine);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === d) { row.push(cell); cell = ""; }
    else if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c !== ""));
}

/** Qué columna corresponde a cada campo; null si falta un encabezado obligatorio. */
export function mapHeaders(header: string[]): { map: Partial<Record<ImportField, number>>; unknown: string[] } {
  const map: Partial<Record<ImportField, number>> = {};
  const unknown: string[] = [];
  header.forEach((h, i) => {
    const n = norm(h);
    const field = (Object.keys(ALIASES) as ImportField[]).find((f) => ALIASES[f].includes(n));
    if (field && map[field] === undefined) map[field] = i;
    else if (n) unknown.push(h);
  });
  return { map, unknown };
}

export type ImportRow = {
  line: number; // renglón en el archivo (1 = encabezados)
  data: Partial<Record<Exclude<ImportField, "lat" | "lng">, string>> & { lat?: number; lng?: number };
  errors: string[];
};

const inZone = (lat: number, lng: number) => lat >= 14 && lat <= 33 && lng >= -118 && lng <= -86;

/** Convierte la tabla en renglones validados. Sin destinatario o sin calle → error del renglón. */
export function readRows(table: string[][]): { rows: ImportRow[]; error?: string; unknown: string[] } {
  if (table.length < 2) return { rows: [], unknown: [], error: "Pega los encabezados y al menos un renglón" };
  const { map, unknown } = mapHeaders(table[0]);
  if (map.addressLine === undefined) return { rows: [], unknown, error: 'Falta la columna "Dirección" (o "Calle")' };
  if (map.recipientName === undefined) return { rows: [], unknown, error: 'Falta la columna "Destinatario" (o "Nombre")' };

  const rows = table.slice(1).map((cells, idx): ImportRow => {
    const get = (f: ImportField) => (map[f] === undefined ? "" : (cells[map[f]!] ?? "").trim());
    const errors: string[] = [];
    const data: ImportRow["data"] = {};
    for (const f of Object.keys(FIELD_LABEL) as ImportField[]) {
      if (f === "lat" || f === "lng") continue; // f: campos de texto
      const v = get(f);
      if (v) data[f] = v.slice(0, f === "instructions" ? 500 : 200);
    }
    if (!data.recipientName || data.recipientName.length < 2) errors.push("Falta destinatario");
    if (!data.addressLine || data.addressLine.length < 5) errors.push("Falta calle y número");
    if (data.zip) {
      const z = data.zip.replace(/\D/g, "");
      if (z.length === 4) data.zip = `0${z}`; // Excel quita el 0 inicial (06800 → 6800)
      else if (z.length === 5) data.zip = z;
      else errors.push("CP inválido");
    }
    if (data.recipientPhone) {
      const digits = data.recipientPhone.replace(/\D/g, "");
      if (digits.length < 8 || digits.length > 15) errors.push("Teléfono inválido");
    }
    const lat = Number(get("lat").replace(",", "."));
    const lng = Number(get("lng").replace(",", "."));
    if (get("lat") || get("lng")) {
      if (Number.isFinite(lat) && Number.isFinite(lng) && inZone(lat, lng)) { data.lat = lat; data.lng = lng; }
      else errors.push("Coordenadas inválidas");
    }
    return { line: idx + 2, data, errors };
  });
  return { rows, unknown };
}

/** Texto para buscar la dirección en el mapa. */
export function geocodeQuery(d: ImportRow["data"]): string {
  return [d.addressLine, d.neighborhood, d.zip, d.city, d.state ?? "México"].filter(Boolean).join(", ");
}

export const TEMPLATE_HEADERS = ["Destinatario", "Teléfono", "Dirección", "Colonia", "CP", "Alcaldía / municipio", "Estado", "Referencias", "Contenido"];
