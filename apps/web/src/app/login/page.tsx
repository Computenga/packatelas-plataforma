import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import { homeFor } from "@/lib/roles";
import { LoginForm } from "./login-form";
import { Logo } from "@/components/brand";

export const metadata: Metadata = { title: "Entrar" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const listo = (await searchParams).listo === "1";
  const user = await getSessionUser();
  if (user) redirect(homeFor(user.role));

  return (
    <main className="flex min-h-dvh items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="sr-only">Packatelas</h1>
          <Logo className="mx-auto mb-3 h-10 w-auto" />
          <p className="text-sm text-slate-500">Operación, entregas y cobranza</p>
        </div>
        {listo && <p className="mb-4 rounded-lg bg-emerald-50 px-4 py-3 text-center text-sm text-emerald-800">Contraseña cambiada. Entra con tu nueva contraseña.</p>}
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <LoginForm />
        </div>
        <div className="mt-4 space-y-1 text-center text-sm">
          <p><Link href="/acceso" className="font-medium text-brand hover:underline">¿Eres cliente y es tu primera vez? Activa tu cuenta con tu número de cliente</Link></p>
          <p><Link href="/acceso/restablecer" className="text-slate-500 hover:underline">Olvidé mi contraseña</Link></p>
        </div>
        <p className="mt-6 text-center text-sm text-slate-500">
          ¿Tienes una tienda y quieres enviar con nosotros? <Link href="/registro" className="text-brand hover:underline">Regístrate</Link>
          <br />
          ¿Solo un envío? <Link href="/enviar" className="text-brand hover:underline">Mándalo sin registrarte</Link>
          <br />
          ¿Quieres ser repartidor? <Link href="/alta" className="text-brand hover:underline">Regístrate aquí</Link>
        </p>
      </div>
    </main>
  );
}
