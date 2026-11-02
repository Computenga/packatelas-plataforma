// "Dónde vende": siempre un enlace para poder validar la tienda (Mercado Libre, web, Instagram…).

const URLISH = /(https?:\/\/[^\s,;|]+|(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|mx|net|org|shop|store|tienda|online|site|co|me|io|app|link|ly|page|biz|info|lat)(?:\.[a-z]{2})?(?:\/[^\s,;|]*)?)/gi;

/** Enlaces que haya en el texto, con https:// y una etiqueta corta («mercadolibre.com.mx/tienda/x»). */
export function storeLinks(text?: string | null): { href: string; label: string }[] {
  const out: { href: string; label: string }[] = [];
  for (const m of (text ?? "").matchAll(URLISH)) {
    const raw = m[0].replace(/[).]+$/, "");
    if (/@/.test(text!.slice(Math.max(0, m.index! - 1), m.index!))) continue; // parte de un correo
    const href = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    try {
      const u = new URL(href);
      const label = `${u.hostname.replace(/^www\./, "")}${u.pathname !== "/" ? u.pathname : ""}`.slice(0, 60);
      if (!out.some((o) => o.href === u.href)) out.push({ href: u.href, label });
    } catch {
      /* no es un enlace válido */
    }
  }
  return out;
}

/** Valida y normaliza lo capturado: null si no trae ningún enlace. */
export function normalizeStoreUrl(raw?: string | null): string | null {
  const links = storeLinks(raw);
  return links.length ? links.map((l) => l.href).join(" ") : null;
}
