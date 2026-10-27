import type { Metadata } from "next";

export const metadata: Metadata = { title: "MercadoLibre", robots: { index: false } };

export default async function MlConectado({ searchParams }: PageProps<"/ml/conectado">) {
  const sp = await searchParams;
  const str = (v: string | string[] | undefined) => (typeof v === "string" ? v.slice(0, 200) : "");
  const error = str(sp.error);
  return (
    <main className="flex min-h-dvh items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-brand text-xl font-bold text-white">P</div>
        {error ? (
          <>
            <h1 className="text-lg font-bold text-red-700">No se pudo conectar</h1>
            <p role="alert" className="mt-2 text-sm text-slate-600">{error}</p>
          </>
        ) : (
          <>
            <h1 className="text-lg font-bold text-emerald-700">¡Cuenta conectada!</h1>
            <p className="mt-2 text-sm text-slate-600">
              La cuenta <strong>{str(sp.cuenta)}</strong> de MercadoLibre quedó ligada a <strong>{str(sp.cliente)}</strong> en Packatelas.
              Ya puedes cerrar esta ventana.
            </p>
            {str(sp.registrada) && (
              <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
                Esta cuenta ya estaba registrada en Packatelas con el cliente <strong>{str(sp.registrada)}</strong>, así que quedó autorizada ahí.
                Si debe ir con otra de tus cuentas de cliente, Packatelas ya recibió el aviso para moverla.
              </p>
            )}
            <a href="/cliente/mercadolibre" className="mt-4 inline-block text-sm text-brand hover:underline">Volver a mi portal</a>
          </>
        )}
      </div>
    </main>
  );
}
