import type { Metadata } from "next";
import Link from "next/link";
import { SignupForm } from "./signup-form";
import { Isotipo } from "@/components/brand";

export const metadata: Metadata = { title: "Registro de tienda" };

export default function RegistroPage() {
  return (
    <main className="min-h-dvh bg-slate-50 px-4 py-10">
      <div className="mx-auto max-w-2xl">
        <div className="mb-8 text-center">
          <Isotipo className="mx-auto mb-3 h-12 w-auto" />
          <h1 className="text-2xl font-bold text-slate-900">Registra tu tienda en Packatelas</h1>
          <p className="mt-1 text-sm text-slate-600">
            Recolectamos en tu negocio y entregamos el mismo día en CDMX y Estado de México. Revisamos tu solicitud y te
            contactamos para activar tu cuenta.
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <SignupForm />
        </div>
        <p className="mt-6 text-center text-sm text-slate-500">
          ¿Ya tienes cuenta? <Link href="/login" className="text-brand hover:underline">Entra aquí</Link>
        </p>
      </div>
    </main>
  );
}
