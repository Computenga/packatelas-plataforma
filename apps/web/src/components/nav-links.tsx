"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { NavItem } from "@/lib/roles";
import { NAV_DOT, NAV_ICONS, NAV_SHORT as SHORT, NavIcon } from "./nav-icons";

const styles = {
  side: {
    list: "space-y-0.5",
    item: "flex items-center justify-between rounded-md px-3 py-[7px] text-[15px]",
    active: "bg-accent font-bold text-brand",
    idle: "text-slate-300 hover:bg-white/[0.06] hover:text-white",
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
    active: "font-bold text-accent",
    idle: "text-slate-400",
  },
};

const Count = ({ n, on }: { n?: number; on?: boolean }) =>
  n ? <span className={`ml-2 rounded-full px-1.5 text-xs font-bold tabular-nums ${on ? "bg-brand text-accent" : "bg-white/15 text-white"}`}>{n > 99 ? "99+" : n}</span> : null;

export function NavLinks({ nav, ready, variant, counts = {} }: { nav: NavItem[]; ready: string[]; variant: keyof typeof styles; counts?: Record<string, number> }) {
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
          <span className={`${s.item} cursor-default text-slate-500`} title="Disponible próximamente">
            {it.label}
            {variant === "side" && <span className="text-[11px]">pronto</span>}
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
            <>
              <span className="truncate">{it.label}</span>
              {variant === "side" && <Count n={counts[it.href]} on={active} />}
            </>
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
    // Secciones desplegables: la de la página actual abierta; las demás se abren con un toque.
    return (
      <div className="space-y-1">
        {groups.map((g, gi) => {
          if (!g.title) return <ul key={gi} className={s.list}>{g.items.map(item)}</ul>;
          const here = g.items.some((i) => i.href === match);
          const pending = g.items.reduce((n, i) => n + (counts[i.href] ?? 0), 0);
          return (
            <details key={g.title} open={here || undefined} className="group">
              <summary className="flex cursor-pointer list-none items-center justify-between rounded-md px-3 py-2 text-[13px] font-semibold text-accent select-none hover:bg-white/[0.04] [&::-webkit-details-marker]:hidden">
                <span>{g.title}</span>
                <span className="flex items-center gap-1">
                  {pending > 0 && <span className="text-xs font-bold text-white group-open:hidden">{pending}</span>}
                  <svg aria-hidden viewBox="0 0 20 20" className="h-4 w-4 transition-transform group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="m5 8 5 5 5-5" />
                  </svg>
                </span>
              </summary>
              <ul className={`${s.list} pb-2`}>{g.items.map(item)}</ul>
            </details>
          );
        })}
      </div>
    );
  }
  return <ul className={s.list}>{nav.map(item)}</ul>;
}
