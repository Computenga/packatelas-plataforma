"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { saveEmpresa } from "@/lib/rh-empresa";
import { EMPRESA_DEFAULT } from "@/lib/rh-text";

export async function saveEmpresaAction(_prev: unknown, form: FormData) {
  await requireUser(["ADMIN"]);
  const data: Record<string, string> = {};
  for (const k of Object.keys(EMPRESA_DEFAULT)) data[k] = String(form.get(k) ?? "").trim();
  await saveEmpresa(data);
  revalidatePath("/admin/personal", "layout");
  return { ok: true, message: "Datos de la empresa guardados" };
}
