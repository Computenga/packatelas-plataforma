import { requireUser } from "@/lib/auth";
import { logout } from "@/app/login/actions";
import { Logo } from "@/components/brand";
import { GATE_ROLES } from "@/lib/roles";

/** Recepción en tablet (iPad horizontal): pantalla completa, sin menú. */
export default async function RecepcionLayout({ children }: LayoutProps<"/recepcion">) {
  const user = await requireUser(GATE_ROLES);
  return (
    <div className="min-h-dvh bg-slate-100">
      <header className="flex items-center justify-between gap-3 bg-[#14213d] px-5 py-3 text-white">
        <div className="flex items-center gap-3">
          <span className="rounded-lg bg-white px-2 py-1"><Logo className="h-6 w-auto" /></span>
          <span className="text-lg font-semibold">Recepción</span>
        </div>
        <form action={logout} className="flex items-center gap-3 text-sm">
          <span className="opacity-80">{user.name}</span>
          <button className="rounded-lg border border-white/40 px-3 py-1.5">Salir</button>
        </form>
      </header>
      <main className="mx-auto max-w-6xl p-4 sm:p-5">{children}</main>
    </div>
  );
}
