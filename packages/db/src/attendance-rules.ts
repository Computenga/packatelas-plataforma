// Reglas de formato de asistencia sin dependencias (también las usa el navegador).

const DAY_LETTERS: Record<string, number> = { l: 1, m: 2, x: 3, mi: 3, j: 4, v: 5, s: 6, d: 7 };
const DAY_NAMES: [string, number][] = [["lun", 1], ["mar", 2], ["mie", 3], ["jue", 4], ["vie", 5], ["sab", 6], ["dom", 7]];
export const deaccent = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** "1,2,3,4,5,6", "L-S", "Lun a Sáb", "L,M,X,J,V", "LMXJVS" → [1…7]. Vacío → null. */
export function parseWorkdays(raw: string | null | undefined): number[] | null {
  const s = deaccent(raw ?? "");
  if (!s) return null;
  if (/^[1-7](\s*[,;\s]\s*[1-7])*$/.test(s)) return [...new Set(s.split(/[,;\s]+/).map(Number))].sort();
  const tok = (t: string): number | null => {
    const n = DAY_NAMES.find(([k]) => t.startsWith(k));
    if (n) return n[1];
    return DAY_LETTERS[t] ?? null;
  };
  const range = s.match(/^([a-z]+)\s*(?:-|a|al)\s*([a-z]+)$/);
  if (range) {
    const a = tok(range[1]), b = tok(range[2]);
    if (a && b && a <= b) return Array.from({ length: b - a + 1 }, (_, i) => a + i);
  }
  const parts = s.includes(",") || s.includes(" ") ? s.split(/[,\s]+/) : /^[lmxjvsd]+$/.test(s) ? s.split("") : [s];
  const out = parts.map((p) => tok(p)).filter((x): x is number => !!x);
  return out.length ? [...new Set(out)].sort() : null;
}

/** "9", "09:30", "9:30:00", "9:30 am" → "09:30"; null si no es hora. */
export function parseClock(raw: string | null | undefined): string | null {
  const m = (raw ?? "").trim().toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*(am|pm|a\.m\.|p\.m\.)?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  if (m[3]?.startsWith("p") && h < 12) h += 12;
  if (m[3]?.startsWith("a") && h === 12) h = 0;
  return h < 24 && min < 60 ? `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}` : null;
}

/** Tipo de checada del reloj/hoja → clave interna. */
export function normalizePunchKind(raw: string | null | undefined): string | undefined {
  const s = deaccent(raw ?? "");
  if (!s) return undefined;
  if (/regres|vuelta|in.*comida|fin.*comida/.test(s)) return "regreso_comida";
  if (/comid|comer|lunch|break/.test(s)) return "salida_comida";
  if (/entrada|check.?in|^in$|^0$/.test(s)) return "entrada";
  if (/salida|check.?out|^out$|^1$/.test(s)) return "salida";
  return undefined;
}

