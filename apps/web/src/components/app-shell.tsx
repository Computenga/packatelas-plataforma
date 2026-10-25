import Link from "next/link";
import type { ReactNode } from "react";
import { logout } from "@/app/login/actions";
import type { NavItem } from "@/lib/roles";
import { NavLinks } from "./nav-links";

type Props = {
  title: string;
  userName: string;
  roleLabel: string;
  nav: NavItem[];
  /** Rutas ya construidas; el resto se muestra como "pronto". */
  ready: string[];
  /** Repartidor y cliente en celular: navegación inferior. */
  mobileBottomNav?: boolean;
  children: ReactNode;
};

export function AppShell({ title, userName, roleLabel, nav, ready, mobileBottomNav, children }: Props) {
  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-slate-200 bg-white md:flex">
        <div className="flex items-center gap-2 px-5 py-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand font-bold text-white">P</div>
          <div>
            <p className="font-semibold leading-tight">Packatelas</p>
            <p className="text-xs text-slate-500">{title}</p>
          </div>
        </div>
        <nav className="flex-1 px-3">
          <NavLinks nav={nav} ready={ready} variant="side" />
        </nav>
        <UserBox userName={userName} roleLabel={roleLabel} />
      </aside>

      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 md:hidden">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand text-sm font-bold text-white">P</div>
          <span className="font-semibold">{title}</span>
        </div>
        <form action={logout}>
          <button className="text-sm text-slate-500">Salir</button>
        </form>
      </header>

      {!mobileBottomNav && (
        <nav className="overflow-x-auto border-b border-slate-200 bg-white px-2 md:hidden">
          <NavLinks nav={nav} ready={ready} variant="top" />
        </nav>
      )}

      <main className={`flex-1 p-4 md:p-8 ${mobileBottomNav ? "pb-24 md:pb-8" : ""}`}>{children}</main>

      {mobileBottomNav && (
        <nav className="fixed inset-x-0 bottom-0 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden">
          <NavLinks nav={nav} ready={ready} variant="bottom" />
        </nav>
      )}
    </div>
  );
}

function UserBox({ userName, roleLabel }: { userName: string; roleLabel: string }) {
  return (
    <div className="border-t border-slate-200 p-4">
      <p className="truncate text-sm font-medium">{userName}</p>
      <p className="text-xs text-slate-500">{roleLabel}</p>
      <form action={logout} className="mt-2">
        <button className="text-sm text-slate-500 hover:text-slate-900">Cerrar sesión</button>
      </form>
      <Link href="/" className="sr-only">
        Inicio
      </Link>
    </div>
  );
}
