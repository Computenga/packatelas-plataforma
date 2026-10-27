import type { Metadata } from "next";
import Link from "next/link";
import { requireClient } from "@/lib/client-scope";
import { Card } from "@/components/ui";
import { MlConnect } from "@/components/ml-connect";

export const metadata: Metadata = { title: "Cuentas de MercadoLibre" };

/** El cliente conecta sus cuentas de MercadoLibre [C02]. */
export default async function MercadoLibrePage({ searchParams }: PageProps<"/cliente/mercadolibre">) {
  const { clientId } = await requireClient();
  const sp = await searchParams;
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-xl font-bold">Cuentas de MercadoLibre</h1>
      {sp.conectada === "1" && <p className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">Listo: tu cuenta quedó conectada.</p>}
      <Card>
        <MlConnect clientId={clientId} self />
      </Card>
      <Card title="Qué pasa al conectarla">
        <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
          <li>Cuando escaneamos tu paquete en bodega, el envío aparece con destinatario y dirección.</li>
          <li>Solo leemos los datos de tus envíos; no podemos publicar, vender ni tocar tu dinero.</li>
          <li>Puedes quitar el permiso cuando quieras desde tu cuenta de MercadoLibre.</li>
        </ul>
      </Card>
      <p className="text-xs text-slate-500">
        ¿Vendes en tu propia tienda (WooCommerce, Shopify) o tienes un sistema? Eso va en <Link href="/cliente/api" className="text-brand hover:underline">Tiendas en línea y API</Link>.
      </p>
    </div>
  );
}
