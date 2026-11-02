import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { guestStatus, pickupDayLabel, prisma } from "@packatelas/db";
import { Isotipo } from "@/components/brand";
import { mxn, STATUS_LABEL } from "@/lib/format";
import { trackingPath } from "@/lib/tracking";

export const metadata: Metadata = { title: "Tu envío", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function GuestStatusPage({ params, searchParams }: PageProps<"/enviar/[token]">) {
  const { token } = await params;
  const g = await guestStatus(prisma, token);
  if (!g) notFound();
  const failed = (await searchParams).pago === "error";
  const paid = g.status === "PAID" && g.order;
  const expired = g.checkout.status === "EXPIRED" || g.checkout.status === "REJECTED";

  return (
    <main className="min-h-dvh bg-slate-50 px-4 py-10">
      <div className="mx-auto max-w-lg space-y-4">
        <Isotipo className="mx-auto h-10 w-auto" />
        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          {paid ? (
            <>
              <p className="text-4xl">✅</p>
              <h1 className="mt-2 text-xl font-bold">¡Pago recibido!</h1>
              <p className="mt-1 text-sm text-slate-600">
                Tu envío es <span className="font-mono font-bold">{g.order!.code}</span>. Pasamos a recogerlo el <strong>{pickupDayLabel(g.pickupDate.toISOString().slice(0, 10))}</strong>.
                Escribe ese número en el paquete.
              </p>
              <p className="mt-3 text-sm">Estado: <strong>{STATUS_LABEL[g.order!.status]}</strong></p>
              <Link href={trackingPath(g.order!.id)} className="mt-4 inline-block rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white">Seguir mi envío</Link>
              <p className="mt-3 text-xs text-slate-500">Guarda esta página: aquí ves el avance. Comparte el enlace de seguimiento con quien recibe.</p>
            </>
          ) : expired || failed ? (
            <>
              <p className="text-4xl">⚠️</p>
              <h1 className="mt-2 text-xl font-bold">El pago no se completó</h1>
              <p className="mt-1 text-sm text-slate-600">No se hizo ningún cargo. Puedes intentarlo de nuevo.</p>
              <Link href="/enviar" className="mt-4 inline-block rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white">Volver a intentar</Link>
            </>
          ) : (
            <>
              <p className="text-4xl">⏳</p>
              <h1 className="mt-2 text-xl font-bold">Confirmando tu pago…</h1>
              <p className="mt-1 text-sm text-slate-600">Mercado Pago nos avisa en unos segundos. Recarga esta página en un momento.</p>
              <meta httpEquiv="refresh" content="10" />
            </>
          )}
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm">
          <p><span className="text-slate-500">Recolección:</span> {g.pickupAddress}</p>
          <p className="mt-1"><span className="text-slate-500">Entrega:</span> {g.recipientName}, {[g.addressLine, g.neighborhood, g.city, g.zip].filter(Boolean).join(", ")}</p>
          <p className="mt-1"><span className="text-slate-500">Contenido:</span> {g.contents}</p>
          <p className="mt-1"><span className="text-slate-500">Total:</span> {mxn(g.price)}</p>
        </div>
        <p className="text-center text-xs text-slate-500">¿Dudas? WhatsApp +52 56 1123 2342</p>
      </div>
    </main>
  );
}
