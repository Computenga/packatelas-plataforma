import type { Metadata } from "next";
import Link from "next/link";
import { conversation, listConversations, prisma, replyWindow, STAGE_LABEL, waKey, whoIs } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import { fecha } from "@/lib/format";
import { Badge, PageHeader } from "@/components/ui";
import { replyAction } from "./actions";
import { LiveRefresh } from "./live-refresh";
import { ReplyForm } from "./reply-form";

export const metadata: Metadata = { title: "WhatsApp" };
export const dynamic = "force-dynamic";
const HORA = new Intl.DateTimeFormat("es-MX", { timeZone: "America/Mexico_City", weekday: "short", hour: "numeric", minute: "2-digit" });
const KIND: Record<string, string> = { image: "📷 Foto", audio: "🎤 Audio", video: "🎬 Video", document: "📄 Documento", sticker: "Sticker", location: "📍 Ubicación", template: "Plantilla", button: "Botón" };

/** Bandeja de WhatsApp: lo que escriben al número de avisos y las respuestas desde el portal. */
export default async function WhatsappPage({ searchParams }: PageProps<"/admin/whatsapp">) {
  await requireUser(["ADMIN"]);
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : "";
  const tel = typeof sp.tel === "string" && /^\d{10,13}$/.test(sp.tel) ? waKey(sp.tel) : null;
  const convs = await listConversations(prisma, { q });
  const current = tel ?? null;
  const [msgs, win, who] = current ? await Promise.all([conversation(prisma, current), replyWindow(prisma, current), whoIs(prisma, current)]) : [[], null, {}];
  const head = current ? convs.find((c) => c.phone === current) : null;

  return (
    <div className="mx-auto max-w-6xl">
      <LiveRefresh />
      <PageHeader eyebrow="Clientes" title="WhatsApp">
        Lo que escriben al número de avisos (prospectos de la invitación a Flex, tiendas, compradores). Respondes desde aquí con texto libre durante 24 h después de su último mensaje.
      </PageHeader>
      <div className="grid gap-4 md:grid-cols-[320px_1fr]">
        <aside className={`rounded-xl bg-white ${current ? "hidden md:block" : ""}`}>
          <form className="border-b border-slate-100 p-2">
            <input name="q" defaultValue={q} placeholder="Buscar nombre o teléfono" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          </form>
          <ul className="max-h-[70vh] divide-y divide-slate-100 overflow-y-auto">
            {convs.map((c) => (
              <li key={c.phone}>
                <Link href={`/admin/whatsapp?tel=${c.phone}`} className={`block px-3 py-2.5 text-sm hover:bg-slate-50 ${c.phone === current ? "bg-slate-100" : ""}`}>
                  <span className="flex items-center justify-between gap-2">
                    <span className={`truncate ${c.unread ? "font-bold" : "font-medium"}`}>{c.name ?? `+${c.phone}`}</span>
                    <span className="shrink-0 text-[11px] text-slate-500">{HORA.format(c.last.at)}</span>
                  </span>
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs text-slate-500">{c.last.direction === "out" ? "Tú: " : ""}{c.last.text ?? KIND[c.last.kind] ?? "Mensaje"}</span>
                    {c.unread > 0 && <span className="shrink-0 rounded-full bg-accent px-1.5 text-[11px] font-bold text-brand">{c.unread}</span>}
                  </span>
                  {!c.windowOpen && <span className="text-[11px] text-slate-400">ventana cerrada</span>}
                </Link>
              </li>
            ))}
            {convs.length === 0 && <li className="p-4 text-sm text-slate-500">Aún no hay mensajes.</li>}
          </ul>
        </aside>

        <section className={`flex min-h-[60vh] flex-col rounded-xl bg-white ${current ? "" : "hidden md:flex"}`}>
          {!current ? (
            <p className="m-auto text-sm text-slate-500">Elige una conversación.</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 p-3">
                <div>
                  <Link href="/admin/whatsapp" className="mr-2 text-sm text-brand md:hidden">←</Link>
                  <strong>{head?.name ?? `+${current}`}</strong> <span className="font-mono text-xs text-slate-500">+{current}</span>
                </div>
                <div className="flex flex-wrap gap-2 text-xs">
                  {"lead" in who && who.lead && <Link href={`/admin/crm/${who.lead.id}`} className="rounded bg-slate-100 px-2 py-1 text-brand">CRM: {who.lead.businessName} · {STAGE_LABEL[who.lead.stage]}</Link>}
                  {"client" in who && who.client && <Link href={`/admin/clientes/${who.client.id}`} className="rounded bg-slate-100 px-2 py-1 text-brand">Cliente {who.client.publicId.toUpperCase()} · {who.client.name}</Link>}
                </div>
              </div>
              <ol className="flex-1 space-y-2 overflow-y-auto bg-floor p-3">
                {msgs.map((m) => (
                  <li key={m.id} className={`flex ${m.direction === "out" ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[80%] rounded-xl px-3 py-2 text-sm shadow-sm ${m.direction === "out" ? (m.kind === "template" ? "bg-slate-200" : "bg-[#dcf8c6]") : "bg-white"}`}>
                      {m.kind === "template" && <p className="mb-1 text-[11px] font-semibold text-slate-500">Aviso automático</p>}
                      {m.mediaId && (m.kind === "image" || m.kind === "sticker"
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={`/api/whatsapp/media/${m.mediaId}`} alt="" className="mb-1 max-h-64 rounded" />
                        : <a href={`/api/whatsapp/media/${m.mediaId}`} target="_blank" rel="noreferrer" className="mb-1 block text-brand underline">{KIND[m.kind] ?? "Archivo"}</a>)}
                      {m.text ? <p className="whitespace-pre-wrap break-words">{m.text}</p> : !m.mediaId && <p className="text-slate-500">{KIND[m.kind] ?? "Mensaje"}</p>}
                      <p className="mt-1 text-right text-[11px] text-slate-500">
                        {m.by && `${m.by} · `}{HORA.format(m.createdAt)}
                        {m.direction === "out" && <> · {m.status === "read" ? "✓✓ leído" : m.status === "delivered" ? "✓✓" : m.status === "failed" ? <Badge tone="red">no se envió</Badge> : "✓"}</>}
                      </p>
                      {m.error && <p className="text-[11px] text-red-700">{m.error}</p>}
                    </div>
                  </li>
                ))}
              </ol>
              <div className="border-t border-slate-100 p-3">
                <ReplyForm action={replyAction.bind(null, current)} open={!!win?.open} until={win?.until ? fecha(win.until) : null} />
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
