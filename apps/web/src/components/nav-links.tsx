"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { NavItem } from "@/lib/roles";
import { NAV_DOT, NAV_ICONS, NavIcon } from "./nav-icons";

/** Nombres cortos para que quepan abajo en el celular. */
const SHORT: Record<string, string> = { "/repartidor/recolecciones": "Recolectas", "/mecanico/documentos": "Docs" };

const styles = {
  side: {
    list: "space-y-1",
    item: "flex items-center justify-between rounded-lg px-3 py-2 text-sm",
    active: "bg-brand/[0.06] font-semibold text-brand shadow-[inset_3px_0_0_var(--color-accent)]",
    idle: "text-slate-600 hover:bg-slate-100",
  },
  top: {
    list: "flex gap-1 py-2",
    item: "whitespace-nowrap rounded-full px-3 py-1.5 text-sm",
    active: "bg-brand text-white",
    idle: "text-slate-600",
  },
  bottom: {
    list: "grid auto-cols-fr grid-flow-col",
    item: "flex flex-col items-center gap-0.5 px-0.5 pt-2 pb-1.5 text-[11px] leading-tight",
    active: "font-semibold text-brand",
    idle: "text-slate-500",
  },
};

export function NavLinks({ nav, ready, variant }: { nav: NavItem[]; ready: string[]; variant: keyof typeof styles }) {
  const pathname = usePathname();
  const s = styles[variant];
  return (
    <ul className={s.list}>
      {nav.map((item) => {
        const isReady = ready.includes(item.href);
        const root = nav[0]?.href;
        const active = item.href === root ? pathname === item.href : pathname === item.href || pathname.startsWith(item.href + "/");
        if (!isReady) {
          return (
            <li key={item.href}>
              <span className={`${s.item} cursor-default text-slate-400`} title="Disponible próximamente">
                {item.label}
                {variant === "side" && <span className="text-[10px] uppercase tracking-wide">pronto</span>}
              </span>
            </li>
          );
        }
        return (
          <li key={item.href}>
            <Link href={item.href} className={`${s.item} ${active ? s.active : s.idle}`}>
              {variant === "bottom" ? (
                <>
                  <NavIcon>{NAV_ICONS[item.href] ?? NAV_DOT}</NavIcon>
                  <span className="max-w-full truncate">{SHORT[item.href] ?? item.label}</span>
                </>
              ) : (
                item.label
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
