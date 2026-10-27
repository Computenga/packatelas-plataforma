import Link from "next/link";

const TABS = [
  { key: "saldos", label: "Saldos y pagos", href: "/admin/cobros" },
  { key: "reglas", label: "Crédito", href: "/admin/cobros/reglas" },
  { key: "antiguedad", label: "Antigüedad de saldos", href: "/admin/cobros/antiguedad" },
  { key: "mercadopago", label: "Mercado Pago", href: "/admin/cobros/mercadopago" },
] as const;

export function CobrosTabs({ active }: { active: (typeof TABS)[number]["key"] }) {
  return (
    <nav className="flex gap-1 border-b border-slate-200 text-sm" aria-label="Cobros">
      {TABS.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={active === t.key ? "page" : undefined}
          className={`-mb-px border-b-2 px-3 py-2 ${active === t.key ? "border-brand font-semibold text-brand" : "border-transparent text-slate-600 hover:text-slate-900"}`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
