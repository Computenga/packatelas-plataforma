import Link from "next/link";
import type { ReactNode } from "react";
import { logout } from "@/app/login/actions";
import type { NavItem } from "@/lib/roles";
import { NavLinks } from "./nav-links";
import { MobileNav } from "./mobile-nav";
import { PushPrompt } from "./push-prompt";
import { AppUpdateBanner } from "./app-update-banner";
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
  /** Ofrecer notificaciones push; texto opcional de la invitación. */
  push?: boolean;
  pushText?: string;
  /** Sin navegación inferior: accesos fijos abajo en celular; el resto va en el menú ☰. */
  favorites?: string[];
  /** Pendientes por sección del menú (p. ej. { "/admin/despacho": 12 }). */
  counts?: Record<string, number>;
  children: ReactNode;
};

export function AppShell({ title, userName, roleLabel, nav, ready, mobileBottomNav, push = true, pushText, favorites = [], counts, children }: Props) {
  const hasFavs = !mobileBottomNav && favorites.some((h) => nav.some((n) => n.href === h) && ready.includes(h));
  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r-4 border-accent bg-brand md:flex">
        <div className="px-5 pt-5 pb-4">
          <Logo light className="h-6 w-auto" />
          <p className="mt-1.5 text-sm text-slate-400">{title}</p>
        </div>
        <nav className="flex-1 overflow-y-auto px-3 pb-4">
          <NavLinks nav={nav} ready={ready} variant="side" counts={counts} />
        </nav>
        <UserBox userName={userName} roleLabel={roleLabel} />
      </aside>

      {mobileBottomNav ? (
        <header className="flex items-center justify-between border-b-4 border-accent bg-brand px-4 py-3 text-white md:hidden">
          <div className="flex items-center gap-2">
            <Isotipo light className="h-7 w-auto" />
            <span className="font-display text-xl font-extrabold">{title}</span>
          </div>
          <form action={logout}>
            <LogoutButton compact />
          </form>
        </header>
      ) : (
        <MobileNav title={title} userName={userName} roleLabel={roleLabel} nav={nav} ready={ready} favorites={favorites} counts={counts} />
      )}

      <main className={`min-w-0 flex-1 p-4 md:p-8 ${mobileBottomNav || hasFavs ? "pb-24 md:pb-8" : ""}`}>
        <AppUpdateBanner />
        {push && <PushPrompt text={pushText} />}
        {children}
      </main>

      {mobileBottomNav && (
        <nav className="fixed inset-x-0 bottom-0 z-30 bg-brand pb-[env(safe-area-inset-bottom)] md:hidden">
          <NavLinks nav={nav} ready={ready} variant="bottom" />
        </nav>
      )}
    </div>
  );
}

function UserBox({ userName, roleLabel }: { userName: string; roleLabel: string }) {
  return (
    <div className="border-t border-white/10 p-4 text-white">
      <p className="truncate text-sm font-semibold">{userName}</p>
      <p className="text-xs text-slate-400">{roleLabel}</p>
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
      className={`inline-flex items-center gap-1.5 rounded-lg border border-white/30 font-semibold text-white hover:bg-white/10 ${compact ? "px-2.5 py-1.5 text-xs" : "w-full justify-center px-3 py-2 text-sm"}`}
    >
      <svg aria-hidden viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
        <path d="M8 4H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3M13 14l4-4-4-4M17 10H8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      Cerrar sesión
    </button>
  );
}
