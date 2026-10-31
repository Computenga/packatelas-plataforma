import Link from "next/link";

const TABS = [
  { key: "saldos", label: "Saldos y pagos", href: "/admin/cobros" },
  { key: "reglas", label: "Crédito", href: "/admin/cobros/reglas" },
  { key: "antiguedad", label: "Antigüedad de saldos", href: "/admin/cobros/antiguedad" },
  { key: "mercadopago", label: "Mercado Pago", href: "/admin/cobros/mercadopago" },
  { key: "facturacion", label: "Facturación", href: "/admin/cobros/facturacion" },
] as const;

export function CobrosTabs({ active }: { active: (typeof TABS)[number]["key"] }) {
  return (
    <nav className="flex gap-1 overflow-x-auto border-b border-slate-200 text-sm whitespace-nowrap" aria-label="Cobros">
      {TABS.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={active === t.key ? "page" : undefined}
          className={`-mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-2 ${active === t.key ? "border-brand font-semibold text-brand" : "border-transparent text-slate-600 hover:text-slate-900"}`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
