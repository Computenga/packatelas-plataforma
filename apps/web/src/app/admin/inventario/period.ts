const TZ = "America/Mexico_City";
const ymd = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
const valid = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

/** Periodo de la pantalla (días de la CDMX). Por omisión, los últimos 7 días. */
export function period(sp: Record<string, string | string[] | undefined>, now: Date) {
  const hasta = valid(sp.hasta) ? sp.hasta : ymd(now);
  const desde = valid(sp.desde) ? sp.desde : ymd(new Date(now.getTime() - 6 * 86_400_000));
  return { desde, hasta, from: new Date(`${desde}T00:00:00-06:00`), to: new Date(new Date(`${hasta}T00:00:00-06:00`).getTime() + 86_400_000) };
}
