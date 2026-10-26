import type { Metadata } from "next";
import { HIRE_ROLES } from "@packatelas/db";
import { startApplication } from "./actions";

export const metadata: Metadata = { title: "Alta de personal", robots: { index: false } };

/** Inicio del alta: la persona elige su puesto y recibe su enlace privado [A25]. */
export default async function AltaInicio({ searchParams }: PageProps<"/alta">) {
  const busy = (await searchParams).ocupado === "1";
  return (
    <main className="min-h-dvh bg-slate-50 px-4 py-10">
      <div className="mx-auto max-w-md space-y-6">
        <div className="text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-brand text-xl font-bold text-white">P</div>
          <h1 className="text-2xl font-bold">Bienvenido a Packatelas</h1>
          <p className="mt-1 text-sm text-slate-600">Vamos a registrar tus datos y documentos. Ten a la mano tu INE, CURP, comprobante de domicilio, constancia del SAT, NSS y estado de cuenta.</p>
        </div>
        <form action={startApplication} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <label className="block text-sm font-medium">¿Para qué puesto entras?
            <select name="role" defaultValue="repartidor" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-base">
              {Object.entries(HIRE_ROLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          {busy && <p role="alert" className="text-sm text-red-600">Hay muchas solicitudes en este momento. Intenta en un rato o pide el enlace a RH.</p>}
          <button className="w-full rounded-lg bg-brand py-3 font-semibold text-white">Empezar</button>
          <p className="text-xs text-slate-500">Te daremos un enlace privado para continuar cuando quieras. Guárdalo.</p>
        </form>
      </div>
    </main>
  );
}
