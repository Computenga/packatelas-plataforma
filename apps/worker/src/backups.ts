// Respaldos [P08]: revisa las copias diarias de la base y, si hay DRIVE_REFRESH_TOKEN, las sube
// a una carpeta de Google Drive (fuera del VPS). Usa el mismo cliente OAuth que Gmail.
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { prisma, reportHealth } from "@packatelas/db";

const DIR = process.env.BACKUP_DIR ?? "/backups";
const KEY = "backup.drive";
const KEEP_REMOTE = 30;
const FOLDER = "Packatelas · respaldos";

type DriveState = { folderId?: string; uploaded: { name: string; id: string }[] };

export async function localBackups(dir = DIR) {
  const names = (await readdir(dir).catch(() => [] as string[])).filter((n) => /^packatelas-\d{4}-\d{2}-\d{2}\.dump$/.test(n)).sort();
  return Promise.all(names.map(async (name) => ({ name, ...(await stat(path.join(dir, name)).then((s) => ({ size: s.size, at: s.mtime }))) })));
}

async function driveToken(): Promise<string | null> {
  const { GMAIL_CLIENT_ID: id, GMAIL_CLIENT_SECRET: secret, DRIVE_REFRESH_TOKEN: refresh } = process.env;
  if (!id || !secret || !refresh) return null;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: id, client_secret: secret, refresh_token: refresh, grant_type: "refresh_token" }),
  });
  if (!res.ok) throw new Error(`Drive: no se pudo renovar el acceso (${res.status})`);
  return ((await res.json()) as { access_token: string }).access_token;
}

async function drive<T>(token: string, url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) }, signal: AbortSignal.timeout(300_000) });
  if (!res.ok && res.status !== 404) throw new Error(`Drive ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (res.status === 204 || res.status === 404 ? {} : await res.json()) as T;
}

async function uploadNew(token: string, files: { name: string }[]) {
  const row = await prisma.setting.findUnique({ where: { key: KEY } });
  const st: DriveState = { uploaded: [], ...((row?.value as DriveState | undefined) ?? {}) };
  if (!st.folderId) {
    const f = await drive<{ id: string }>(token, "https://www.googleapis.com/drive/v3/files", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: FOLDER, mimeType: "application/vnd.google-apps.folder" }),
    });
    st.folderId = f.id;
  }
  let sent = 0;
  for (const f of files.filter((x) => !st.uploaded.some((u) => u.name === x.name))) {
    const data = await readFile(path.join(DIR, f.name));
    const boundary = `pk${Date.now()}`;
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name: f.name, parents: [st.folderId] })}\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`),
      data,
      Buffer.from(`\r\n--${boundary}--`),
    ]);
    const up = await drive<{ id: string }>(token, "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart", {
      method: "POST",
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body,
    });
    st.uploaded.push({ name: f.name, id: up.id });
    sent++;
  }
  // Solo los últimos KEEP_REMOTE en Drive.
  st.uploaded.sort((a, b) => a.name.localeCompare(b.name));
  while (st.uploaded.length > KEEP_REMOTE) {
    const old = st.uploaded.shift()!;
    await drive(token, `https://www.googleapis.com/drive/v3/files/${old.id}`, { method: "DELETE" });
  }
  await prisma.setting.upsert({ where: { key: KEY }, update: { value: st }, create: { key: KEY, value: st } });
  return { sent, remote: st.uploaded.length };
}

export async function backupOnce() {
  const files = await localBackups();
  const last = files.at(-1);
  if (!last) {
    await reportHealth(prisma, "respaldos", false, "Aún no hay respaldos: revisa el servicio backup en Coolify");
    return;
  }
  const ageH = (Date.now() - last.at.getTime()) / 3600_000;
  const mb = (last.size / 1048576).toFixed(1);
  let drivePart = "Sin copia fuera del servidor (falta DRIVE_REFRESH_TOKEN)";
  let ok = ageH < 30;
  try {
    const token = await driveToken();
    if (token) {
      const r = await uploadNew(token, files);
      drivePart = `Google Drive: ${r.remote} copia(s)${r.sent ? `, ${r.sent} subida(s) ahora` : ""}`;
    } else ok = false;
  } catch (e) {
    ok = false;
    drivePart = e instanceof Error ? e.message : String(e);
  }
  await reportHealth(prisma, "respaldos", ok, `Último: ${last.name} (${mb} MB, hace ${Math.round(ageH)} h). ${files.length} en el servidor. ${drivePart}`);
}

export function startBackups() {
  const run = () => backupOnce().catch((e) => console.error("[worker] Respaldos:", e instanceof Error ? e.message : e));
  void run();
  setInterval(run, 30 * 60_000);
}
