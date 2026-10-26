// Rango de fechas de los informes (hora CDMX). Por omisión: últimos 7 días, hoy incluido.
const re = /^\d{4}-\d{2}-\d{2}$/;
const ymd = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(d);

export function readRange(sp: Record<string, string | string[] | undefined>, now = new Date()) {
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const today = ymd(now);
  const to = re.test(s("to")) ? s("to") : today;
  const from = re.test(s("from")) ? s("from") : ymd(new Date(new Date(`${to}T12:00:00-06:00`).getTime() - 6 * 86400_000));
  return {
    fromYmd: from,
    toYmd: to,
    range: { from: new Date(`${from}T00:00:00-06:00`), to: new Date(new Date(`${to}T00:00:00-06:00`).getTime() + 86400_000) },
  };
}

export function presets(now = new Date()) {
  const today = ymd(now);
  const back = (days: number) => ymd(new Date(now.getTime() - days * 86400_000));
  const first = `${today.slice(0, 8)}01`;
  return [
    { label: "Hoy", from: today, to: today },
    { label: "7 días", from: back(6), to: today },
    { label: "30 días", from: back(29), to: today },
    { label: "Este mes", from: first, to: today },
  ];
}
