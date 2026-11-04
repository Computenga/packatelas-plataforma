"use server";

import { revalidatePath } from "next/cache";
import { audit, copyDriveFiles, getLegacyConfig, prisma, saveLegacyConfig, syncLegacy } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import type { ActionState } from "@/components/action-form";

const SHEET_ID = /^[A-Za-z0-9_-]{20,80}$/;
const idFrom = (v: FormDataEntryValue | null) => String(v ?? "").trim().match(/\/d\/([A-Za-z0-9_-]+)/)?.[1] ?? String(v ?? "").trim();

export async function saveConfigAction(_: ActionState, fd: FormData): Promise<ActionState> {
  await requireUser(["ADMIN"]);
  const checadorSheetId = idFrom(fd.get("checador")), flotillaSheetId = idFrom(fd.get("flotilla"));
  if (!SHEET_ID.test(checadorSheetId) || !SHEET_ID.test(flotillaSheetId)) return { error: "Pega el enlace o el ID de cada hoja" };
  await saveLegacyConfig(prisma, { enabled: fd.get("enabled") === "on", checadorSheetId, flotillaSheetId });
  revalidatePath("/admin/datos/unificacion");
  return { ok: "Guardado" };
}

export async function syncNowAction(_: ActionState): Promise<ActionState> {
  await requireUser(["ADMIN"]);
  void (await getLegacyConfig(prisma));
  const r = await syncLegacy(prisma, null, { force: true });
  revalidatePath("/admin/datos/unificacion");
  return r.ok ? { ok: "Copia terminada" } : { error: r.errors.join(" · ") };
}

export async function copyFilesNowAction(_: ActionState): Promise<ActionState> {
  await requireUser(["ADMIN"]);
  const r = await copyDriveFiles(prisma, { limit: 40 });
  revalidatePath("/admin/datos/unificacion");
  if (r.error) return { error: r.error };
  return { ok: `${r.copied} copiados${r.failed ? `, ${r.failed} no se pudieron` : ""}; quedan ${r.pending}` };
}

/** Corte: última copia de las hojas y se apaga la copia automática. */
export async function cutoverAction(_: ActionState): Promise<ActionState> {
  const admin = await requireUser(["ADMIN"]);
  const cfg = await getLegacyConfig(prisma);
  const r = await syncLegacy(prisma, null, { force: true });
  if (!r.ok) return { error: `La última copia tuvo errores; corrígelos antes del corte: ${r.errors.join(" · ")}` };
  await saveLegacyConfig(prisma, { ...cfg, enabled: false });
  await audit(prisma, { actorUserId: admin.id, action: "legacy.cutover", entity: "Setting", entityId: "legacy", summary: "Corte de la unificación: copia de hojas apagada" });
  revalidatePath("/admin/datos/unificacion");
  return { ok: "Corte hecho: la copia de las hojas quedó apagada" };
}
