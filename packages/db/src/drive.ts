// Google Drive para los respaldos [P08]: un admin autoriza desde Salud y el permiso (refresh token)
// queda cifrado en la base. Usa el mismo cliente OAuth de Google que Gmail y solo el alcance
// drive.file (la plataforma solo ve los archivos que ella misma crea).
import type { PrismaClient } from "../generated/prisma/client.ts";
import { decryptSecret, encryptSecret } from "./crypto.ts";
import { readMlState, signMlState } from "./ml-api.ts";

export const DRIVE_TOKEN_KEY = "backup.drive.token";
const DRIVE_STATE_KEY = "backup.drive";
const PREFIX = "drive:";
const SCOPE = "https://www.googleapis.com/auth/drive.file openid email";

type Stored = { enc: string; email?: string; at: string; byUserId?: string };

export function driveOAuth() {
  const clientId = process.env.GMAIL_CLIENT_ID?.trim();
  const clientSecret = process.env.GMAIL_CLIENT_SECRET?.trim();
  const base = process.env.PUBLIC_URL?.trim().replace(/\/$/, "");
  if (!clientId || !clientSecret || !base) return null;
  return { clientId, clientSecret, redirectUri: `${base}/api/drive/callback` };
}

/** Enlace a Google para autorizar Drive (vale 30 min). */
export function driveAuthUrl(userId: string) {
  const o = driveOAuth();
  if (!o) return null;
  const q = new URLSearchParams({
    client_id: o.clientId,
    redirect_uri: o.redirectUri,
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state: signMlState(`${PREFIX}${userId}`, 1 / 48),
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

/** Quién pidió la autorización (o null si el estado no es válido). */
export function readDriveState(state: string) {
  const who = readMlState(state);
  return who?.startsWith(PREFIX) ? who.slice(PREFIX.length) : null;
}

/** Cambia el código de Google por el permiso permanente y lo guarda cifrado. */
export async function connectDrive(prisma: PrismaClient, code: string, userId: string): Promise<{ ok: true; email?: string } | { ok: false; error: string }> {
  const o = driveOAuth();
  if (!o) return { ok: false, error: "Falta configurar GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET o PUBLIC_URL" };
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: o.clientId, client_secret: o.clientSecret, redirect_uri: o.redirectUri, grant_type: "authorization_code" }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json().catch(() => ({}))) as { refresh_token?: string; id_token?: string; scope?: string; error_description?: string; error?: string };
  if (!res.ok) return { ok: false, error: `Google rechazó la autorización: ${body.error_description ?? body.error ?? res.status}` };
  if (!body.scope?.includes("drive.file")) return { ok: false, error: "No se concedió el permiso de Google Drive. Vuelve a intentarlo y marca la casilla de Drive." };
  if (!body.refresh_token) return { ok: false, error: "Google no entregó el permiso permanente. Quita el acceso en myaccount.google.com/permissions y vuelve a conectar." };
  let email: string | undefined;
  try {
    email = (JSON.parse(Buffer.from(body.id_token!.split(".")[1], "base64url").toString()) as { email?: string }).email;
  } catch {
    /* sin correo: no es indispensable */
  }
  const value: Stored = { enc: encryptSecret(body.refresh_token), email, at: new Date().toISOString(), byUserId: userId };
  await prisma.$transaction([
    prisma.setting.upsert({ where: { key: DRIVE_TOKEN_KEY }, update: { value }, create: { key: DRIVE_TOKEN_KEY, value } }),
    // Cuenta nueva: la carpeta y la lista de subidos eran de la anterior.
    prisma.setting.deleteMany({ where: { key: DRIVE_STATE_KEY } }),
  ]);
  return { ok: true, email };
}

/** Permiso vigente: el de la variable de entorno o el autorizado desde Salud. */
export async function driveRefreshToken(prisma: PrismaClient): Promise<string | null> {
  const env = process.env.DRIVE_REFRESH_TOKEN?.trim();
  if (env) return env;
  const row = await prisma.setting.findUnique({ where: { key: DRIVE_TOKEN_KEY } });
  const v = row?.value as Stored | undefined;
  return v?.enc ? decryptSecret(v.enc) : null;
}

/** Para la pantalla de Salud: con qué cuenta está conectado. */
export async function driveConnection(prisma: PrismaClient) {
  if (process.env.DRIVE_REFRESH_TOKEN?.trim()) return { connected: true, email: "configurado en el servidor", at: null as string | null };
  const v = (await prisma.setting.findUnique({ where: { key: DRIVE_TOKEN_KEY } }))?.value as Stored | undefined;
  return v?.enc ? { connected: true, email: v.email ?? "cuenta de Google", at: v.at } : { connected: false, email: null, at: null };
}
