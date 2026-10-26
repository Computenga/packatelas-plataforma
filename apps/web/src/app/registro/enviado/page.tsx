import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Solicitud recibida" };

export default function EnviadoPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-2xl text-emerald-700">✓</div>
        <h1 className="text-xl font-bold">Recibimos tu solicitud</h1>
        <p className="mt-2 text-sm text-slate-600">
          La revisamos en horario hábil y te contactamos por WhatsApp o correo. Cuando quede activa podrás entrar con el
          usuario y la contraseña que elegiste para ver tus envíos, saldo y recolecciones.
        </p>
        <Link href="/login" className="mt-6 inline-block text-sm text-brand hover:underline">Ir a iniciar sesión</Link>
      </div>
    </main>
  );
}
