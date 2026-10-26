import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import QRCode from "qrcode";
import { prisma } from "@packatelas/db";
import { getSessionUser } from "@/lib/session";
import { STAFF_ROLES } from "@/lib/roles";
import { PrintButton } from "./print-button";

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
  const qr = await QRCode.toString(order.code, { type: "svg", margin: 0, errorCorrectionLevel: "M" });

  return (
    <main className="min-h-dvh bg-slate-100 p-4 print:bg-white print:p-0">
      <style>{`@page { size: 100mm 150mm; margin: 0 } @media print { .no-print { display: none } }`}</style>
      <div className="no-print mx-auto mb-4 flex max-w-[100mm] justify-between">
        <a href={user.role === "CLIENTE" ? `/cliente/envio/${order.id}` : `/admin/pedidos/${order.id}`} className="text-sm text-brand">← Volver</a>
        <PrintButton />
      </div>
      <section className="mx-auto flex h-[150mm] w-[100mm] flex-col border border-slate-300 bg-white p-[6mm] text-slate-900 print:border-0">
        <div className="flex items-center justify-between border-b-2 border-slate-900 pb-2">
          <span className="text-lg font-black tracking-tight">PACKATELAS</span>
          <span className="text-xs">{order.client.publicId.toUpperCase()}</span>
        </div>
        <div className="mx-auto my-4 w-[48mm]" dangerouslySetInnerHTML={{ __html: qr }} />
        <p className="text-center font-mono text-2xl font-bold">{order.code}</p>
        <div className="mt-4 space-y-1 border-t border-slate-300 pt-3 text-sm">
          <p className="text-[10px] uppercase tracking-wide text-slate-500">Entregar a</p>
          <p className="text-base font-bold leading-tight">{order.recipientName}</p>
          {order.recipientPhone && <p>Tel. {order.recipientPhone}</p>}
          <p className="leading-snug">{[order.addressLine, order.neighborhood].filter(Boolean).join(", ")}</p>
          <p className="leading-snug">{[order.city, order.state, order.zip && `CP ${order.zip}`].filter(Boolean).join(", ")}</p>
          {order.instructions && <p className="text-xs italic">{order.instructions}</p>}
        </div>
        <p className="mt-auto border-t border-slate-300 pt-2 text-[10px] text-slate-500">
          Remitente: {order.client.name}{order.branch ? ` · ${order.branch.name}` : ""}
        </p>
      </section>
    </main>
  );
}
