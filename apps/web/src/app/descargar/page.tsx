import type { Metadata } from "next";
import QRCode from "qrcode";
import { Logo } from "@/components/brand";

export const metadata: Metadata = { title: "Descargar app" };

const VERSION = "1.2";
export const dynamic = "force-dynamic";

/** Página pública para instalar la app Android desde cualquier celular. */
export default async function DescargarPage() {
  const base = (process.env.PUBLIC_URL ?? "https://nuevo.packatelas.mx").replace(/\/$/, "");
  const qr = await QRCode.toDataURL(`${base}/descargar`, { margin: 1, width: 360, color: { dark: "#0f1e4a", light: "#ffffff" } });
  return (
    <main className="min-h-dvh bg-slate-50 px-4 py-10">
      <div className="mx-auto max-w-md space-y-6 text-center">
        <Logo className="mx-auto h-10 w-auto" />
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="text-xl font-bold">App Packatelas para Android</h1>
          <p className="mt-1 text-sm text-slate-600">Versión {VERSION} · repartidores, clientes y administración</p>
          <a href="/app/packatelas.apk" download="packatelas.apk" className="mt-5 inline-block w-full rounded-xl bg-brand px-5 py-3 text-base font-semibold text-white">
            Descargar app (APK)
          </a>
          <ol className="mt-5 space-y-2 text-left text-sm text-slate-700">
            <li>1. Toca «Descargar app». Si Chrome pregunta, elige «Descargar de todos modos».</li>
            <li>2. Abre el archivo <strong>packatelas.apk</strong> desde la notificación o desde Descargas.</li>
            <li>3. Si aparece «Instalar apps desconocidas», da permiso a Chrome (o a Archivos) y regresa.</li>
            <li>4. Toca «Instalar» y abre la app. Entra con tu usuario y contraseña de siempre.</li>
          </ol>
          <p className="mt-4 text-xs text-slate-500">Si ya tienes la app, se actualiza encima sin perder nada.</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-medium">¿Estás en la computadora? Escanea con el celular:</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr} alt="QR para abrir esta página" width={180} height={180} className="mx-auto mt-3" />
          <p className="mt-2 break-all font-mono text-xs text-slate-500">{base}/descargar</p>
        </div>
        <p className="text-xs text-slate-500">¿iPhone? Abre {base.replace(/^https?:\/\//, "")} en Safari y elige «Agregar a pantalla de inicio».</p>
      </div>
    </main>
  );
}
