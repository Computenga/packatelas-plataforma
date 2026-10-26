// Cliente mínimo de la API de Gmail (solo lectura) con refresh token de OAuth.

export type GmailConfig = { clientId: string; clientSecret: string; refreshToken: string };

let cached: { token: string; until: number } | null = null;

export async function accessToken(cfg: GmailConfig): Promise<string> {
  if (cached && cached.until > Date.now() + 60_000) return cached.token;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      refresh_token: cfg.refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`No se pudo renovar el acceso a Gmail (${res.status}): ${await res.text()}`);
  const j = (await res.json()) as { access_token: string; expires_in: number };
  cached = { token: j.access_token, until: Date.now() + j.expires_in * 1000 };
  return j.access_token;
}

async function api<T>(cfg: GmailConfig, path: string): Promise<T> {
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
    headers: { Authorization: `Bearer ${await accessToken(cfg)}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Gmail ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as T;
}

export async function listMessageIds(cfg: GmailConfig, q: string, max = 100): Promise<string[]> {
  const j = await api<{ messages?: { id: string }[] }>(cfg, `messages?q=${encodeURIComponent(q)}&maxResults=${max}`);
  return (j.messages ?? []).map((m) => m.id);
}

type Part = { mimeType?: string; body?: { data?: string }; parts?: Part[] };

const b64url = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");

/** Texto del correo: parte text/plain si existe; si no, el HTML sin etiquetas. */
export function extractText(payload: Part): string {
  const flat: Part[] = [];
  const walk = (p: Part) => {
    flat.push(p);
    p.parts?.forEach(walk);
  };
  walk(payload);
  const plain = flat.find((p) => p.mimeType === "text/plain" && p.body?.data);
  if (plain) return b64url(plain.body!.data!);
  const html = flat.find((p) => p.mimeType === "text/html" && p.body?.data);
  if (!html) return "";
  return b64url(html.body!.data!)
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(div|p|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n");
}

export async function getMessage(cfg: GmailConfig, id: string): Promise<{ id: string; receivedAt: Date; text: string }> {
  const m = await api<{ id: string; internalDate: string; payload: Part }>(cfg, `messages/${id}?format=full`);
  return { id: m.id, receivedAt: new Date(Number(m.internalDate)), text: extractText(m.payload) };
}
