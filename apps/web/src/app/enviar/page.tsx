import type { Metadata } from "next";
import Link from "next/link";
import { earliestPickupDate, guestPrice, mpConfigured, prisma, PICKUP_RULE_TEXT } from "@packatelas/db";
import { Isotipo } from "@/components/brand";
import { mxn } from "@/lib/format";
import { GuestForm } from "./guest-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Envío sin registro", description: "Manda un paquete en CDMX y Estado de México sin crear cuenta." };

export default async function EnviarPage() {
  const price = await guestPrice(prisma);
  return (
    <main className="min-h-dvh bg-slate-50 px-4 py-10">
      <div className="mx-auto max-w-2xl">
        <div className="mb-8 text-center">
          <Isotipo className="mx-auto mb-3 h-12 w-auto" />
          <h1 className="text-2xl font-bold text-slate-900">Manda un paquete sin registrarte</h1>
          <p className="mt-1 text-sm text-slate-600">
            Para un envío ocasional en CDMX y Estado de México: recogemos en tu domicilio y lo entregamos. Precio fijo de{" "}
            <strong>{mxn(price)}</strong> por envío, pagado por adelantado.
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          {mpConfigured() ? (
            <GuestForm price={mxn(price)} minDate={earliestPickupDate()} rule={PICKUP_RULE_TEXT} />
          ) : (
            <p className="text-sm text-slate-600">El pago en línea no está disponible en este momento. Escríbenos por WhatsApp al +52 56 1123 2342.</p>
          )}
        </div>
        <p className="mt-6 text-center text-sm text-slate-500">
          ¿Envías seguido? <Link href="/registro" className="text-brand hover:underline">Registra tu tienda</Link> y obtén tarifa preferencial.
        </p>
      </div>
    </main>
  );
}
