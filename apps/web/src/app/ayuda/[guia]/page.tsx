import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Logo } from "@/components/brand";
import { GUIDES, type Topic } from "../content";

type Slug = keyof typeof GUIDES;
const isSlug = (s: string): s is Slug => s in GUIDES;

export function generateStaticParams() {
  return Object.keys(GUIDES).map((guia) => ({ guia }));
}

export async function generateMetadata({ params }: PageProps<"/ayuda/[guia]">): Promise<Metadata> {
  const { guia } = await params;
  if (!isSlug(guia)) return {};
  return { title: GUIDES[guia].title, description: GUIDES[guia].summary };
}

function Shot({ t }: { t: Topic }) {
  if (!t.shot) return null;
  const phone = t.device !== "desk";
  return (
    <a href={`/ayuda/${t.shot}.webp`} target="_blank" rel="noreferrer" className={phone ? "mx-auto block w-full max-w-[280px] shrink-0" : "block w-full"}>
      {/* eslint-disable-next-line @next/next/no-img-element -- capturas estáticas */}
      <img
        src={`/ayuda/${t.shot}.webp`}
        alt={`Pantalla: ${t.title}`}
        loading="lazy"
        className={`w-full border border-slate-200 bg-white shadow-sm ${phone ? "rounded-[1.6rem] border-4 border-slate-800" : "rounded-xl"}`}
      />
    </a>
  );
}

function Section({ t, n }: { t: Topic; n: number }) {
  const phone = t.shot && t.device !== "desk";
  return (
    <section id={t.id} className="scroll-mt-20 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
      <div className={phone ? "flex flex-col gap-6 md:flex-row md:items-start" : "space-y-5"}>
        <div className="min-w-0 flex-1 space-y-3">
          <h2 className="flex items-center gap-3 text-lg font-semibold">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand text-sm font-bold text-white">{n}</span>
            {t.title}
          </h2>
          <p className="text-slate-700">{t.intro}</p>
          {t.steps && (
            <ol className="space-y-2">
              {t.steps.map((s, i) => (
                <li key={i} className="flex gap-3 text-sm leading-relaxed text-slate-700">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">{i + 1}</span>
                  <span>{s}</span>
                </li>
              ))}
            </ol>
          )}
          {t.tip && <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">💡 {t.tip}</p>}
        </div>
        <Shot t={t} />
      </div>
    </section>
  );
}

/** Manual de uso por tipo de usuario, público para mandarlo por WhatsApp. */
export default async function GuidePage({ params }: PageProps<"/ayuda/[guia]">) {
  const { guia } = await params;
  if (!isSlug(guia)) notFound();
  const g = GUIDES[guia];
  return (
    <main className="min-h-dvh bg-slate-50">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
          <Link href="/ayuda" aria-label="Manual de uso">
            <Logo className="h-6 w-auto sm:h-8" />
          </Link>
          <nav className="flex shrink-0 gap-0.5 text-xs sm:gap-1 sm:text-sm">
            {Object.values(GUIDES).map((x) => (
              <Link
                key={x.slug}
                href={`/ayuda/${x.slug}`}
                className={`whitespace-nowrap rounded-full px-2.5 py-1.5 sm:px-3 ${x.slug === g.slug ? "bg-brand font-semibold text-white" : "text-slate-600 hover:bg-slate-100"}`}
              >
                {x.slug === "tienda" ? "Tiendas" : x.slug === "repartidor" ? "Repartidores" : "Oficina"}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      <div className="mx-auto max-w-5xl gap-8 px-4 py-8 lg:grid lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="hidden lg:block">
          <nav className="sticky top-20 space-y-1 text-sm">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">En este manual</p>
            {g.topics.map((t, i) => (
              <a key={t.id} href={`#${t.id}`} className="block rounded px-2 py-1 text-slate-600 hover:bg-white hover:text-brand">
                {i + 1}. {t.title}
              </a>
            ))}
          </nav>
        </aside>

        <div className="space-y-6">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-brand">{g.who}</p>
            <h1 className="text-2xl font-bold sm:text-3xl">{g.title}</h1>
            <p className="text-slate-600">{g.summary}</p>
            <details className="rounded-xl border border-slate-200 bg-white p-3 text-sm lg:hidden">
              <summary className="cursor-pointer font-medium">Índice ({g.topics.length} temas)</summary>
              <ol className="mt-2 space-y-1">
                {g.topics.map((t, i) => (
                  <li key={t.id}>
                    <a href={`#${t.id}`} className="text-brand">{i + 1}. {t.title}</a>
                  </li>
                ))}
              </ol>
            </details>
          </div>
          {g.topics.map((t, i) => (
            <Section key={t.id} t={t} n={i + 1} />
          ))}
          <p className="pb-10 text-center text-sm text-slate-500">
            ¿Te quedó una duda? {g.slug === "tienda" ? "Levanta un reporte en «Ayuda y soporte» dentro del portal o escríbenos por WhatsApp." : "Pregunta en oficina o a tu coordinador."}{" "}
            <Link href="/login" className="font-medium text-brand hover:underline">Entrar al portal</Link>
          </p>
        </div>
      </div>
    </main>
  );
}
