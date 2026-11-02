// Correo saliente (restablecer contraseña) con la API de Gmail: un admin conecta desde Salud la
// cuenta que envía (alcance gmail.send) y el permiso queda cifrado en la base. Mismo cliente OAuth
// de Google que la lectura de depósitos y los respaldos.
import type { PrismaClient } from "../generated/prisma/client.ts";
import { decryptSecret, encryptSecret } from "./crypto.ts";
import { readMlState, signMlState } from "./ml-api.ts";

const KEY = "mail.sender.token";
const PREFIX = "mail:";
const SCOPE = "https://www.googleapis.com/auth/gmail.send openid email";
type Stored = { enc: string; email?: string; at: string };

function oauth() {
  const clientId = process.env.GMAIL_CLIENT_ID?.trim();
  const clientSecret = process.env.GMAIL_CLIENT_SECRET?.trim();
  const base = process.env.PUBLIC_URL?.trim().replace(/\/$/, "");
  if (!clientId || !clientSecret || !base) return null;
  return { clientId, clientSecret, redirectUri: `${base}/api/correo/callback` };
}

export function mailAuthUrl(userId: string) {
  const o = oauth();
  if (!o) return null;
  const q = new URLSearchParams({
    client_id: o.clientId, redirect_uri: o.redirectUri, response_type: "code", scope: SCOPE,
    access_type: "offline", prompt: "select_account consent", state: signMlState(`${PREFIX}${userId}`, 1 / 48),
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

export function readMailState(state: string) {
  const who = readMlState(state);
  return who?.startsWith(PREFIX) ? who.slice(PREFIX.length) : null;
}

export async function connectMail(prisma: PrismaClient, code: string): Promise<{ ok: true; email?: string } | { ok: false; error: string }> {
  const o = oauth();
  if (!o) return { ok: false, error: "Falta configurar GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET o PUBLIC_URL" };
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: o.clientId, client_secret: o.clientSecret, redirect_uri: o.redirectUri, grant_type: "authorization_code" }),
    signal: AbortSignal.timeout(15_000),
  });
  const b = (await res.json().catch(() => ({}))) as { refresh_token?: string; id_token?: string; scope?: string; error_description?: string; error?: string };
  if (!res.ok) return { ok: false, error: `Google rechazó la autorización: ${b.error_description ?? b.error ?? res.status}` };
  if (!b.scope?.includes("gmail.send")) return { ok: false, error: "No se concedió el permiso de enviar correo. Vuelve a intentarlo y marca la casilla." };
  if (!b.refresh_token) return { ok: false, error: "Google no entregó el permiso permanente. Quita el acceso en myaccount.google.com/permissions y vuelve a conectar." };
  let email: string | undefined;
  try {
    email = (JSON.parse(Buffer.from(b.id_token!.split(".")[1], "base64url").toString()) as { email?: string }).email;
  } catch { /* opcional */ }
  const value: Stored = { enc: encryptSecret(b.refresh_token), email, at: new Date().toISOString() };
  await prisma.setting.upsert({ where: { key: KEY }, update: { value }, create: { key: KEY, value } });
  return { ok: true, email };
}

export async function mailConnection(prisma: PrismaClient) {
  const v = (await prisma.setting.findUnique({ where: { key: KEY } }))?.value as Stored | undefined;
  return v?.enc ? { connected: true, email: v.email ?? "cuenta de Google", at: v.at } : { connected: false as const, email: null, at: null };
}

const encodeHeader = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s).toString("base64")}?=`);

/** Envía un correo HTML. Lanza si no hay cuenta conectada o Google lo rechaza. */
export async function sendMail(prisma: PrismaClient, m: { to: string; subject: string; html: string; text: string }) {
  const o = oauth();
  const v = (await prisma.setting.findUnique({ where: { key: KEY } }))?.value as Stored | undefined;
  if (!o || !v?.enc) throw new Error("No hay correo de envío conectado (Salud → Correo de envío)");
  const tr = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: o.clientId, client_secret: o.clientSecret, refresh_token: decryptSecret(v.enc), grant_type: "refresh_token" }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!tr.ok) throw new Error(`Correo: no se pudo renovar el acceso (${tr.status})`);
  const token = ((await tr.json()) as { access_token: string }).access_token;
  const boundary = `pk${Date.now().toString(36)}`;
  const raw = [
    `From: ${encodeHeader("Packatelas")} <${v.email ?? "me"}>`,
    `To: ${m.to}`,
    `Subject: ${encodeHeader(m.subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(m.text).toString("base64"),
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(m.html).toString("base64"),
    `--${boundary}--`,
  ].join("\r\n");
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw: Buffer.from(raw).toString("base64url") }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Correo: Gmail respondió ${res.status} ${(await res.text()).slice(0, 200)}`);
}
