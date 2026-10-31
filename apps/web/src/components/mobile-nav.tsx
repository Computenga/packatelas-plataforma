"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
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
};

const ICONS: Record<string, ReactNode> = {
  "/admin": <path d="M3 9.5 10 4l7 5.5V16a1 1 0 0 1-1 1h-3.5v-4.5h-5V17H4a1 1 0 0 1-1-1z" />,
  "/admin/escanear": (
    <>
      <path d="M3 7V4h3M14 4h3v3M17 13v3h-3M6 16H3v-3" />
      <path d="M6 10h8" />
    </>
  ),
  "/admin/flotilla": (
    <>
      <circle cx="5" cy="13.5" r="2.5" />
      <circle cx="15" cy="13.5" r="2.5" />
      <path d="M5 13.5 8 8h4l3 5.5M10.5 8 9 5H7M12 8l1-2h2" />
    </>
  ),
  "/admin/despacho": <path d="M3 6h9v8H3zM12 9h3l2 2.5V14h-5M6 16.5a1.5 1.5 0 1 0 0-.01M14 16.5a1.5 1.5 0 1 0 0-.01" />,
  "/admin/pedidos": <path d="M4 6.5 10 3.5l6 3v7l-6 3-6-3zM4 6.5l6 3 6-3M10 9.5v7" />,
};
const DOT = <circle cx="10" cy="10" r="3" />;

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg aria-hidden viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
      {children}
    </svg>
  );
}

export function MobileNav({ title, userName, roleLabel, nav, ready, favorites }: Props) {
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
      <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-slate-200 bg-white px-3 py-2.5 md:hidden">
        <button
          type="button"
          onClick={show}
          aria-label="Abrir menú"
          aria-expanded={isOpen}
          className="-ml-1 inline-flex h-10 w-10 items-center justify-center rounded-lg text-slate-700 hover:bg-slate-100 active:bg-slate-200"
        >
          <svg aria-hidden viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="h-6 w-6">
            <path d="M3 5.5h14M3 10h14M3 14.5h14" />
          </svg>
        </button>
        <Isotipo className="h-7 w-auto" />
        <span className="truncate font-semibold">{title}</span>
      </header>

      {/* Menú lateral */}
      <div className={`fixed inset-0 z-50 md:hidden ${isOpen ? "" : "pointer-events-none"}`} aria-hidden={!isOpen}>
        <div onClick={() => setOpen(false)} className={`absolute inset-0 bg-slate-900/40 transition-opacity ${isOpen ? "opacity-100" : "opacity-0"}`} />
        <aside
          role="dialog"
          aria-label="Menú"
          className={`absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-white shadow-xl transition-transform duration-200 ${isOpen ? "translate-x-0" : "-translate-x-full"}`}
        >
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <div className="flex items-center gap-2">
              <Isotipo className="h-7 w-auto" />
              <span className="font-semibold">{title}</span>
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label="Cerrar menú" className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100">
              <svg aria-hidden viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="h-5 w-5">
                <path d="M5 5l10 10M15 5 5 15" />
              </svg>
            </button>
          </div>
          <nav className="flex-1 overflow-y-auto px-3 py-3" onClick={(e) => (e.target as HTMLElement).closest("a") && setOpen(false)}>
            <NavLinks nav={nav} ready={ready} variant="side" />
          </nav>
          <div className="border-t border-slate-200 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
            <p className="truncate text-sm font-medium">{userName}</p>
            <p className="text-xs text-slate-500">{roleLabel}</p>
            <form action={logout} className="mt-3">
              <button type="submit" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                Cerrar sesión
              </button>
            </form>
          </div>
        </aside>
      </div>

      {/* Favoritos abajo */}
      {favs.length > 0 && (
        <nav aria-label="Favoritos" className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden">
          <ul className="grid auto-cols-fr grid-flow-col">
            {favs.map((f) => (
              <li key={f.href}>
                <Link href={f.href} className={`flex flex-col items-center gap-0.5 py-2 text-xs ${isActive(f.href) ? "font-semibold text-brand" : "text-slate-500"}`}>
                  <Icon>{ICONS[f.href] ?? DOT}</Icon>
                  {f.label}
                </Link>
              </li>
            ))}
            <li>
              <button type="button" onClick={show} className="flex w-full flex-col items-center gap-0.5 py-2 text-xs text-slate-500">
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
