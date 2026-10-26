import type { Metadata } from "next";

export const metadata: Metadata = { title: "Términos del servicio" };

// Borrador operativo: Packatelas debe revisarlo antes de publicarlo [C01].
export default function TerminosPage() {
  return (
    <main className="min-h-dvh bg-slate-50 px-4 py-10">
      <article className="mx-auto max-w-2xl space-y-4 rounded-2xl border border-slate-200 bg-white p-8 text-sm leading-relaxed text-slate-700">
        <h1 className="text-2xl font-bold text-slate-900">Términos del servicio</h1>
        <p className="text-xs text-slate-500">Comercializadora Computenga · Packatelas</p>
        <h2 className="pt-2 font-semibold text-slate-900">1. Servicio</h2>
        <p>Packatelas recolecta paquetes en la dirección registrada por la tienda y los entrega en la Ciudad de México y el Estado de México, según la cobertura vigente.</p>
        <h2 className="pt-2 font-semibold text-slate-900">2. Cargos</h2>
        <p>Cada paquete se cobra al registrarse en nuestro almacén o al recolectarse, con la tarifa acordada al activar la cuenta. Los cargos y abonos se consultan en el portal.</p>
        <h2 className="pt-2 font-semibold text-slate-900">3. Pagos</h2>
        <p>Los pagos se hacen por transferencia escribiendo el ID de cliente en el concepto, para aplicarlos automáticamente. Con saldo pendiente, Packatelas puede suspender las recolecciones hasta regularizarlo.</p>
        <h2 className="pt-2 font-semibold text-slate-900">4. Entregas no realizadas</h2>
        <p>Si no se logra la entrega después de los intentos establecidos, o el destinatario la rechaza, el paquete regresa a nuestro almacén y se devuelve a la tienda.</p>
        <h2 className="pt-2 font-semibold text-slate-900">5. Datos personales</h2>
        <p>Usamos los datos de la tienda y de los destinatarios solo para prestar el servicio, facturar y comunicarnos sobre los envíos.</p>
      </article>
    </main>
  );
}
