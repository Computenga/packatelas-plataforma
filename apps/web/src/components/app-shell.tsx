import Link from "next/link";
import type { ReactNode } from "react";
import { logout } from "@/app/login/actions";
import type { NavItem } from "@/lib/roles";
import { NavLinks } from "./nav-links";
import { PushPrompt } from "./push-prompt";
import { Isotipo, Logo } from "@/components/brand";

type Props = {
  title: string;
  userName: string;
  roleLabel: string;
  nav: NavItem[];
  /** Rutas ya construidas; el resto se muestra como "pronto". */
  ready: string[];
  /** Repartidor y cliente en celular: navegación inferior. */
  mobileBottomNav?: boolean;
  /** Ofrecer notificaciones push (personal interno). */
  push?: boolean;
  children: ReactNode;
};

export function AppShell({ title, userName, roleLabel, nav, ready, mobileBottomNav, push = true, children }: Props) {
  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-slate-200 bg-white md:flex">
        <div className="px-5 py-5">
          <Logo className="h-7 w-auto" />
          <p className="mt-1.5 text-xs font-medium tracking-wide text-slate-500 uppercase">{title}</p>
        </div>
        <nav className="flex-1 overflow-y-auto px-3">
          <NavLinks nav={nav} ready={ready} variant="side" />
        </nav>
        <UserBox userName={userName} roleLabel={roleLabel} />
      </aside>

      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 md:hidden">
        <div className="flex items-center gap-2">
          <Isotipo className="h-7 w-auto" />
          <span className="font-semibold">{title}</span>
        </div>
        <form action={logout}>
          <LogoutButton compact />
        </form>
      </header>

      {!mobileBottomNav && (
        <nav className="overflow-x-auto border-b border-slate-200 bg-white px-2 md:hidden">
          <NavLinks nav={nav} ready={ready} variant="top" />
        </nav>
      )}

      <main className={`flex-1 p-4 md:p-8 ${mobileBottomNav ? "pb-24 md:pb-8" : ""}`}>
        {push && <PushPrompt />}
        {children}
      </main>

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
      <form action={logout} className="mt-3">
        <LogoutButton />
      </form>
      <Link href="/" className="sr-only">
        Inicio
      </Link>
    </div>
  );
}

function LogoutButton({ compact = false }: { compact?: boolean }) {
  return (
    <button
      type="submit"
      className={`inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white font-medium text-slate-700 hover:border-slate-400 hover:bg-slate-50 ${compact ? "px-2.5 py-1.5 text-xs" : "w-full justify-center px-3 py-2 text-sm"}`}
    >
      <svg aria-hidden viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
        <path d="M8 4H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3M13 14l4-4-4-4M17 10H8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      Cerrar sesión
    </button>
  );
}
