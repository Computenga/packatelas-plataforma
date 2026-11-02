import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/brand";
import { ResetRequestForm } from "./form";

export const metadata: Metadata = { title: "Restablecer contraseña" };

export default async function RestablecerPage({ searchParams }: PageProps<"/acceso/restablecer">) {
  const u = (await searchParams).u;
  return (
    <main className="flex min-h-dvh items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-sm">
        <Logo className="mx-auto mb-6 h-10 w-auto" />
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="mb-1 text-lg font-bold">¿Olvidaste tu contraseña?</h1>
          <p className="mb-5 text-sm text-slate-600">Te mandamos un enlace al correo de tu cuenta para crear una nueva.</p>
          <ResetRequestForm u={typeof u === "string" ? u : undefined} />
        </div>
        <p className="mt-6 text-center text-sm text-slate-500">
          <Link href="/login" className="text-brand hover:underline">Volver a entrar</Link> · <Link href="/acceso" className="text-brand hover:underline">Primer acceso</Link>
        </p>
      </div>
    </main>
  );
}
