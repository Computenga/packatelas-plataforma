"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma, saveStoreProduct } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import { saveEvidence, sniffImage } from "@/lib/uploads";

export type ProductState = { error?: string };
const num = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").replace(/[$,\s]/g, "");
  return s === "" ? null : Number(s);
};

/** Alta o edición de un producto de la tienda (fotos nuevas + las que se conservan, en orden). */
export async function saveProductAction(id: string | null, _: ProductState, fd: FormData): Promise<ProductState> {
  const user = await requireUser(["ADMIN"]);
  const keep = fd.getAll("keep").map(String).filter((k) => /^store\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.(jpg|png|webp)$/.test(k));
  const files = fd.getAll("photos").filter((f): f is File => f instanceof File && f.size > 0);
  if (keep.length + files.length > 10) return { error: "Máximo 10 fotos por producto" };
  const added: string[] = [];
  for (const f of files) {
    if (f.size > 6 * 1024 * 1024) return { error: `La foto «${f.name}» pesa más de 6 MB` };
    const buf = Buffer.from(await f.arrayBuffer());
    const ext = sniffImage(buf);
    if (!ext) return { error: `«${f.name}» no es una imagen JPG, PNG o WebP` };
    added.push(await saveEvidence(buf, ext, "store"));
  }
  const price = num(fd.get("price"));
  const stock = num(fd.get("stock"));
  try {
    await saveStoreProduct(prisma, id, {
      name: String(fd.get("name") ?? ""), category: String(fd.get("category") ?? ""), price: price ?? NaN, salePrice: num(fd.get("salePrice")),
      sku: String(fd.get("sku") ?? ""), stock: stock ?? NaN, description: String(fd.get("description") ?? ""), images: [...keep, ...added],
      active: fd.get("active") === "on",
    }, user.id);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "No se pudo guardar" };
  }
  revalidatePath("/admin/tienda");
  revalidatePath("/cliente/tienda");
  redirect("/admin/tienda?guardado=1");
}
