import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { appsFor, docTypesFor, findApplication, HIRE_ROLES, latestByType, prisma } from "@packatelas/db";
import { DocUploader } from "@/components/doc-uploader";
import { DataForm, SubmitButton } from "./forms";
import { Isotipo } from "@/components/brand";

export const metadata: Metadata = { title: "Mi alta", robots: { index: false } };

/** Alta con enlace privado: datos, documentos y apps [A25]. */
export default async function AltaPage({ params, searchParams }: PageProps<"/alta/[token]">) {
  const { token } = await params;
  const app = await findApplication(prisma, token);
  if (!app) notFound();
  const justSent = (await searchParams).enviada === "1";
  const [types, apps] = await Promise.all([docTypesFor(prisma, app.role), appsFor(prisma, app.role)]);
  const latest = latestByType(app.documents);
  const closed = app.status === "APROBADA" || app.status === "RECHAZADA";
  const v = Object.fromEntries(Object.entries(app).map(([k, x]) => [k, typeof x === "string" ? x : null]));
  const step = (n: number, t: string) => <h2 className="mb-3 flex items-center gap-2 font-semibold"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand text-xs text-white">{n}</span>{t}</h2>;

  return (
    <main className="min-h-dvh bg-slate-50 px-4 py-6">
      <div className="mx-auto max-w-2xl space-y-5">
        <header className="flex items-center gap-2">
          <Isotipo className="h-9 w-auto" />
          <div>
            <p className="font-bold leading-tight">Alta de personal</p>
            <p className="text-xs text-slate-500">Puesto: {HIRE_ROLES[app.role] ?? app.role} · guarda este enlace para continuar después</p>
          </div>
        </header>

        {(justSent || app.status === "ENVIADA") && (
          <div role="status" className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            Enviaste tu solicitud. RH revisará tus documentos; si alguno se rechaza verás aquí qué corregir.
          </div>
        )}
        {app.status === "APROBADA" && <div className="rounded-xl bg-emerald-600 px-4 py-3 text-sm text-white">¡Listo! Ya eres parte del equipo. RH te dará tu usuario para entrar a la app.</div>}
        {app.status === "RECHAZADA" && <div className="rounded-xl bg-amber-100 px-4 py-3 text-sm text-amber-900">Tu solicitud no continuó. Comunícate con RH.</div>}

        <section className="rounded-2xl border border-slate-200 bg-white p-5">{step(1, "Tus datos")}<DataForm token={token} v={v} locked={closed} /></section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          {step(2, "Tus documentos")}
          <p className="mb-2 text-xs text-slate-500">Toma una foto clara o sube un PDF. Los marcados con * son obligatorios.</p>
          <DocUploader
            endpoint={`/api/alta/${token}/doc`}
            locked={closed}
            rows={types.map((t) => {
              const d = latest.get(t.key);
              return { key: t.key, name: t.name, description: t.description, required: t.required, status: d?.status ?? null, comment: d?.comment ?? null };
            })}
          />
        </section>

        {apps.length > 0 && (
          <section className="rounded-2xl border border-slate-200 bg-white p-5">
            {step(3, "Apps que vas a usar")}
            <ul className="grid gap-2 sm:grid-cols-2">
              {apps.map((a) => (
                <li key={a.key} className="flex items-center gap-3 rounded-lg border border-slate-200 p-3">
                  <span className="text-2xl" aria-hidden>{a.icon}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{a.name}</span>
                    <span className="block text-xs text-slate-500">{a.description}</span>
                  </span>
                  {a.installUrl && <a href={a.installUrl} target="_blank" rel="noreferrer" className="rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-white">Instalar</a>}
                </li>
              ))}
            </ul>
          </section>
        )}

        {app.status === "EN_PROCESO" && (
          <section className="rounded-2xl border border-slate-200 bg-white p-5">{step(apps.length ? 4 : 3, "Enviar")}<SubmitButton key={app.documents.map((d) => d.id).join()} token={token} /></section>
        )}
      </div>
    </main>
  );
}
