import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/brand";
import { GUIDES } from "./content";

export const metadata: Metadata = { title: "Manual de uso", description: "Cómo usar la plataforma Packatelas: tiendas, repartidores y oficina" };

const ICON = { tienda: "🏪", repartidor: "🛵", admin: "🗂️" } as const;

/** Índice público del manual de uso. */
export default function AyudaPage() {
  return (
    <main className="min-h-dvh bg-slate-50 px-4 py-10">
      <div className="mx-auto max-w-3xl space-y-8">
        <header className="space-y-3 text-center">
          <Logo className="mx-auto h-10 w-auto" />
          <h1 className="text-2xl font-bold sm:text-3xl">Manual de uso</h1>
          <p className="text-slate-600">Elige tu manual. Cada uno explica, paso a paso y con pantallas, cómo usar la plataforma la primera vez.</p>
        </header>
        <ul className="grid gap-4 sm:grid-cols-3">
          {Object.values(GUIDES).map((g) => (
            <li key={g.slug}>
              <Link href={`/ayuda/${g.slug}`} className="flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-brand hover:shadow">
                <span className="text-3xl" aria-hidden>{ICON[g.slug]}</span>
                <span className="mt-3 font-semibold">{g.title}</span>
                <span className="mt-1 text-xs text-slate-500">{g.who}</span>
                <span className="mt-3 flex-1 text-sm text-slate-600">{g.summary}</span>
                <span className="mt-4 text-sm font-semibold text-brand">Abrir manual →</span>
              </Link>
            </li>
          ))}
        </ul>
        <p className="text-center text-sm text-slate-500">
          ¿Ya tienes cuenta? <Link href="/login" className="font-medium text-brand hover:underline">Entrar al portal</Link>
        </p>
      </div>
    </main>
  );
}
