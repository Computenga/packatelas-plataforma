"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { logout } from "@/app/login/actions";
import type { NavItem } from "@/lib/roles";
import { Isotipo } from "./brand";
import { NavLinks } from "./nav-links";

type Props = {
  title: string;
  userName: string;
  roleLabel: string;
  nav: NavItem[];
  ready: string[];
  /** Rutas que van fijas abajo (solo las que el rol puede ver). */
  favorites: string[];
  counts?: Record<string, number>;
};

import { NAV_ICONS as ICONS, NAV_DOT as DOT, NAV_SHORT, NavIcon as Icon } from "./nav-icons";

export function MobileNav({ title, userName, roleLabel, nav, ready, favorites, counts }: Props) {
  const [open, setOpen] = useState(false);
  const [openedAt, setOpenedAt] = useState<string | null>(null);
  const pathname = usePathname();
  // Al navegar, el menú se cierra solo.
  const isOpen = open && openedAt === pathname;

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [isOpen]);

  const show = () => {
    setOpenedAt(pathname);
    setOpen(true);
  };
  const favs = favorites.map((h) => nav.find((n) => n.href === h)).filter((n): n is NavItem => !!n && ready.includes(n.href));
  const root = nav[0]?.href;
  const isActive = (href: string) => (href === root ? pathname === href : pathname === href || pathname.startsWith(href + "/"));

  return (
    <>
      <header className="sticky top-0 z-30 flex items-center gap-3 border-b-4 border-accent bg-brand px-3 py-2.5 text-white md:hidden">
        <button
          type="button"
          onClick={show}
          aria-label="Abrir menú"
          aria-expanded={isOpen}
          className="-ml-1 inline-flex h-10 w-10 items-center justify-center rounded-lg text-white hover:bg-white/10 active:bg-white/20"
        >
          <svg aria-hidden viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="h-6 w-6">
            <path d="M3 5.5h14M3 10h14M3 14.5h14" />
          </svg>
        </button>
        <Isotipo light className="h-7 w-auto" />
        <span className="truncate font-display text-xl font-extrabold">{title}</span>
      </header>

      {/* Menú lateral */}
      <div className={`fixed inset-0 z-50 md:hidden ${isOpen ? "" : "pointer-events-none"}`} aria-hidden={!isOpen}>
        <div onClick={() => setOpen(false)} className={`absolute inset-0 bg-slate-900/40 transition-opacity ${isOpen ? "opacity-100" : "opacity-0"}`} />
        <aside
          role="dialog"
          aria-label="Menú"
          className={`absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col border-r-4 border-accent bg-brand text-white shadow-xl transition-transform duration-200 ${isOpen ? "translate-x-0" : "-translate-x-full"}`}
        >
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
            <div className="flex items-center gap-2">
              <Isotipo light className="h-7 w-auto" />
              <span className="font-display text-xl font-extrabold">{title}</span>
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label="Cerrar menú" className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-300 hover:bg-white/10">
              <svg aria-hidden viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="h-5 w-5">
                <path d="M5 5l10 10M15 5 5 15" />
              </svg>
            </button>
          </div>
          <nav className="flex-1 overflow-y-auto px-3 py-3" onClick={(e) => (e.target as HTMLElement).closest("a") && setOpen(false)}>
            <NavLinks nav={nav} ready={ready} variant="side" counts={counts} />
          </nav>
          <div className="border-t border-white/10 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
            <p className="truncate text-sm font-semibold">{userName}</p>
            <p className="text-xs text-slate-400">{roleLabel}</p>
            <form action={logout} className="mt-3">
              <button type="submit" className="w-full rounded-lg border border-white/30 px-3 py-2 text-sm font-semibold text-white hover:bg-white/10">
                Cerrar sesión
              </button>
            </form>
          </div>
        </aside>
      </div>

      {/* Favoritos abajo */}
      {favs.length > 0 && (
        <nav aria-label="Favoritos" className="fixed inset-x-0 bottom-0 z-30 bg-brand pb-[env(safe-area-inset-bottom)] md:hidden">
          <ul className="grid auto-cols-fr grid-flow-col">
            {favs.map((f) => (
              <li key={f.href}>
                <Link href={f.href} className={`flex flex-col items-center gap-0.5 px-0.5 py-2 text-[11px] leading-tight ${isActive(f.href) ? "font-bold text-accent" : "text-slate-400"}`}>
                  <Icon>{ICONS[f.href] ?? DOT}</Icon>
                  <span className="max-w-full truncate">{NAV_SHORT[f.href] ?? f.label}</span>
                </Link>
              </li>
            ))}
            <li>
              <button type="button" onClick={show} className="flex w-full flex-col items-center gap-0.5 py-2 text-[11px] leading-tight text-slate-400">
                <Icon>
                  <path d="M3 5.5h14M3 10h14M3 14.5h14" />
                </Icon>
                Menú
              </button>
            </li>
          </ul>
        </nav>
      )}
    </>
  );
}
