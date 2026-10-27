import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import { homeFor } from "@/lib/roles";
import { LoginForm } from "./login-form";
import { Logo } from "@/components/brand";

export const metadata: Metadata = { title: "Entrar" };

export default async function LoginPage() {
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
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <LoginForm />
        </div>
        <p className="mt-6 text-center text-sm text-slate-500">
          ¿Tienes una tienda y quieres enviar con nosotros? <Link href="/registro" className="text-brand hover:underline">Regístrate</Link>
        </p>
      </div>
    </main>
  );
}
