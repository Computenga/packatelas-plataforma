import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@packatelas/db";
import { getSessionUser } from "@/lib/session";
import { STAFF_ROLES } from "@/lib/roles";
import { PrintButton } from "./print-button";
import { ShippingLabel } from "@/components/shipping-label";

export const metadata: Metadata = { title: "Etiqueta" };

/**
 * Etiqueta 10×15 cm para envíos propios (PK-): el QR lleva el código, que el escáner de bodega
 * y el del repartidor ya reconocen [C04, A03].
 */
export default async function EtiquetaPage({ params }: PageProps<"/etiqueta/[id]">) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const { id } = await params;
  const order = await prisma.order.findUnique({
    where: { id },
    include: { client: { select: { name: true, publicId: true } }, branch: { select: { name: true } } },
  });
  const allowed = order && (STAFF_ROLES.includes(user.role) || (user.role === "CLIENTE" && user.clientId === order.clientId));
  if (!order || !allowed) notFound();

  return (
    <main className="min-h-dvh bg-slate-100 p-4 print:bg-white print:p-0">
      <style>{`@page { size: 100mm 150mm; margin: 0 } @media print { .no-print { display: none } }`}</style>
      <div className="no-print mx-auto mb-4 flex max-w-[100mm] justify-between">
        <a href={user.role === "CLIENTE" ? `/cliente/envio/${order.id}` : `/admin/pedidos/${order.id}`} className="text-sm text-brand">← Volver</a>
        <PrintButton />
      </div>
      <ShippingLabel order={order} />
    </main>
  );
}
