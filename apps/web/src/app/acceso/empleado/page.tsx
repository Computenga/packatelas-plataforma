import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/brand";
import { EmpAccessForm } from "./form";

export const metadata: Metadata = { title: "Activa tu cuenta de empleado" };

/** Primer acceso del personal: RFC + número de empleado → crear contraseña. */
export default function EmpleadoAccesoPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-sm">
        <Logo className="mx-auto mb-6 h-10 w-auto" />
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="mb-1 text-lg font-bold">Primer acceso del personal</h1>
          <p className="mb-5 text-sm text-slate-600">Activa tu cuenta con tu RFC y tu número de empleado. Aquí ves tu asistencia, recibos de nómina, expediente y, si eres repartidor, tu ruta y tu moto.</p>
          <EmpAccessForm />
        </div>
        <p className="mt-6 text-center text-sm text-slate-500">
          ¿Ya tienes contraseña? <Link href="/login" className="text-brand hover:underline">Entrar</Link>
        </p>
      </div>
    </main>
  );
}
