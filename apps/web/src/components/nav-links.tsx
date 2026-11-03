"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { NavItem } from "@/lib/roles";
import { NAV_DOT, NAV_ICONS, NAV_SHORT as SHORT, NavIcon } from "./nav-icons";

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
  const root = nav[0]?.href;
  // La ruta más específica que coincide (p. ej. /admin/personal/altas sobre /admin/personal).
  const match = nav
    .filter((i) => (i.href === root ? pathname === i.href : pathname === i.href || pathname.startsWith(i.href + "/")))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  const item = (it: NavItem) => {
    const active = it.href === match;
    if (!ready.includes(it.href)) {
      return (
        <li key={it.href}>
          <span className={`${s.item} cursor-default text-slate-400`} title="Disponible próximamente">
            {it.label}
            {variant === "side" && <span className="text-[10px] uppercase tracking-wide">pronto</span>}
          </span>
        </li>
      );
    }
    return (
      <li key={it.href}>
        <Link href={it.href} className={`${s.item} ${active ? s.active : s.idle}`} aria-current={active ? "page" : undefined}>
          {variant === "bottom" ? (
            <>
              <NavIcon>{NAV_ICONS[it.href] ?? NAV_DOT}</NavIcon>
              <span className="max-w-full truncate">{SHORT[it.href] ?? it.label}</span>
            </>
          ) : (
            it.label
          )}
        </Link>
      </li>
    );
  };

  // Menú lateral con secciones: un título por grupo.
  if (variant === "side" && nav.some((i) => i.section)) {
    const groups: { title?: string; items: NavItem[] }[] = [];
    for (const it of nav) {
      const last = groups[groups.length - 1];
      if (last && last.title === it.section) last.items.push(it);
      else groups.push({ title: it.section, items: [it] });
    }
    return (
      <div className="space-y-4">
        {groups.map((g, gi) => (
          <div key={g.title ?? gi}>
            {g.title && <p className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{g.title}</p>}
            <ul className={s.list}>{g.items.map(item)}</ul>
          </div>
        ))}
      </div>
    );
  }
  return <ul className={s.list}>{nav.map(item)}</ul>;
}
