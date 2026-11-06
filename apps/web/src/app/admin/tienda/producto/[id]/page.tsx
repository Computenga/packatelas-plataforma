import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import { Card, PageHeader } from "@/components/ui";
import { saveProductAction } from "../../product-actions";
import { ProductForm } from "./product-form";

export const metadata: Metadata = { title: "Producto · Tienda" };

/** Alta (/admin/tienda/producto/nuevo) o edición de un producto de la tienda de insumos. */
export default async function ProductoPage({ params }: PageProps<"/admin/tienda/producto/[id]">) {
  await requireUser(["ADMIN"]);
  const { id } = await params;
  const isNew = id === "nuevo";
  const p = isNew ? null : await prisma.storeProduct.findUnique({ where: { id } });
  if (!isNew && !p) notFound();
  const categories = (await prisma.storeProduct.findMany({ distinct: ["category"], select: { category: true }, orderBy: { category: "asc" } })).map((c) => c.category);
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link href="/admin/tienda" className="text-sm text-brand hover:underline">← Tienda</Link>
      <PageHeader eyebrow="Tienda de insumos" title={isNew ? "Nuevo producto" : p!.name}>
        {isNew ? "Lo que captures aquí es lo que ven las tiendas en su portal." : p!.wooId ? "Producto que venía de WooCommerce: ya no se actualiza desde allá; edítalo aquí." : "Los cambios se ven al momento en la tienda."}
      </PageHeader>
      <Card>
        <ProductForm
          action={saveProductAction.bind(null, isNew ? null : id)}
          categories={categories}
          initial={{
            name: p?.name ?? "", category: p?.category ?? "Insumos", price: p ? Number(p.price).toFixed(2) : "", salePrice: p?.salePrice ? Number(p.salePrice).toFixed(2) : "",
            sku: p?.sku ?? "", stock: p ? String(p.stock) : "", description: p?.description ?? "", images: p?.images ?? [], active: p?.active ?? true,
          }}
        />
        {p && !p.images.length && p.imageUrl && <p className="mt-3 text-xs text-slate-500">Mientras no subas fotos se usa la de WooCommerce.</p>}
      </Card>
    </div>
  );
}
