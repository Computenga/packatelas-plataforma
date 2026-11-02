import { fecha } from "@/lib/format";

type Msg = { id: string; fromStaff: boolean; internal: boolean; text: string; attachmentKey: string | null; createdAt: Date; authorId: string | null };

/** Conversación del reporte. `viewer` decide de qué lado van las burbujas. */
export function TicketThread({ messages, viewer, names }: { messages: Msg[]; viewer: "staff" | "client"; names: Map<string, string> }) {
  return (
    <ol className="space-y-3">
      {messages.map((m) => {
        const mine = viewer === "staff" ? m.fromStaff : !m.fromStaff;
        const who = m.fromStaff ? (viewer === "client" ? "Equipo Packatelas" : names.get(m.authorId ?? "") ?? "Equipo") : names.get(m.authorId ?? "") ?? "Tienda";
        return (
          <li key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm ${
                m.internal ? "border border-dashed border-amber-300 bg-amber-50" : mine ? "bg-brand text-white" : "bg-slate-100 text-slate-900"
              }`}
            >
              <p className={`mb-1 text-xs ${mine && !m.internal ? "text-white/80" : "text-slate-500"}`}>
                {m.internal ? "🔒 Nota interna · " : ""}
                {who} · {fecha(m.createdAt)}
              </p>
              <p className="whitespace-pre-wrap break-words">{m.text}</p>
              {m.attachmentKey && (
                <a href={`/api/soporte/adjunto/${m.attachmentKey}`} target="_blank" rel="noreferrer" className="mt-2 block">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/soporte/adjunto/${m.attachmentKey}`} alt="Foto adjunta" className="max-h-64 rounded-lg object-cover" />
                </a>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
