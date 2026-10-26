import { quincenaOf, ymdMx } from "@packatelas/db";

/** Quincena pedida en la URL (?q=2026-10-2) o la actual. */
export function readQuincena(raw: unknown) {
  const k = typeof raw === "string" && /^\d{4}-\d{2}-[12]$/.test(raw) ? raw : null;
  return k ? quincenaOf(`${k.slice(0, 7)}-${k.endsWith("1") ? "01" : "16"}`) : quincenaOf(ymdMx(new Date()));
}
