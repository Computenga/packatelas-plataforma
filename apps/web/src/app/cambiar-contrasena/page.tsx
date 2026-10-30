import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import { homeFor } from "@/lib/roles";
import { Logo } from "@/components/brand";
import { ChangeForm } from "./form";

export const metadata: Metadata = { title: "Cambiar contraseña" };

export default async function CambiarPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!user.mustChangePassword) redirect(homeFor(user.role));
  return (
    <main className="flex min-h-dvh items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm">
        <Logo className="mx-auto mb-6 h-10 w-auto" />
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="text-lg font-bold">Hola, {user.name.split(" ")[0]}</h1>
          <p className="mb-4 text-sm text-slate-600">Antes de continuar, cambia tu contraseña temporal por una tuya.</p>
          <ChangeForm />
        </div>
      </div>
    </main>
  );
}
