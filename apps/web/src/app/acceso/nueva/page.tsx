import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/brand";
import { NewPasswordForm } from "./form";

export const metadata: Metadata = { title: "Contraseña nueva" };

export default async function NuevaPage({ searchParams }: PageProps<"/acceso/nueva">) {
  const t = (await searchParams).t;
  return (
    <main className="flex min-h-dvh items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-sm">
        <Logo className="mx-auto mb-6 h-10 w-auto" />
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="mb-4 text-lg font-bold">Crea tu contraseña nueva</h1>
          {typeof t === "string" && t ? <NewPasswordForm token={t} /> : <p className="text-sm text-red-700">El enlace no es válido. <Link href="/acceso/restablecer" className="underline">Pide uno nuevo</Link>.</p>}
        </div>
      </div>
    </main>
  );
}
