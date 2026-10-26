"use server";

import { revalidatePath } from "next/cache";
import { importMlAccounts, parseMlImport, planMlImport, prisma, type MlImportPlan } from "@packatelas/db";
import { requireUser } from "@/lib/auth";

export type MlImportState = { error?: string; ok?: string; plan?: MlImportPlan; text?: string };

export async function mlImportAction(_: MlImportState, fd: FormData): Promise<MlImportState> {
  const user = await requireUser(["ADMIN"]);
  const text = String(fd.get("text") ?? "");
  const parsed = parseMlImport(text);
  if (parsed.error) return { error: parsed.error, text };
  if (parsed.rows.length > 1000) return { error: "Máximo 1000 cuentas por carga", text };
  if (fd.get("mode") !== "import") return { plan: await planMlImport(prisma, parsed.rows), text };
  const r = await importMlAccounts(prisma, parsed.rows, user.id);
  if (!r.ok) return { error: r.error, text };
  revalidatePath("/admin/clientes");
  return { ok: `Listo: ${r.created} nuevas, ${r.moved} cambiadas de cliente, ${r.unchanged} sin cambio.` };
}
