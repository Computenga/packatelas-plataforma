import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { readPendingLogin } from "@/lib/two-factor";
import { VerifyForm } from "./verify-form";

export const metadata: Metadata = { title: "Verificación" };

export default async function VerificarPage() {
  if (!(await readPendingLogin())) redirect("/login");
  return (
    <main className="flex min-h-dvh items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-brand text-xl font-bold text-white">P</div>
          <h1 className="text-xl font-bold text-slate-900">Verificación en dos pasos</h1>
          <p className="text-sm text-slate-500">Escribe el código de 6 dígitos de tu app autenticadora.</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <VerifyForm />
        </div>
        <p className="mt-4 text-center text-sm"><Link href="/login" className="text-slate-500 hover:underline">Volver</Link></p>
      </div>
    </main>
  );
}
