import { DocReview } from "./doc-review";

type Doc = { id: string; fileKey: string; fileName: string | null; mime: string; status: "PENDIENTE" | "APROBADO" | "RECHAZADO"; comment: string | null; uploadedAt: Date };
type Row = { type: { key: string; name: string; required: boolean }; doc: Doc | null };
const TONE = { APROBADO: "bg-emerald-50 text-emerald-700", PENDIENTE: "bg-blue-50 text-blue-700", RECHAZADO: "bg-red-50 text-red-700" } as const;
const LABEL = { APROBADO: "Aprobado", PENDIENTE: "Por revisar", RECHAZADO: "Rechazado" } as const;

/** Vista de RH: miniatura de cada documento y su revisión. */
export function DocListAdmin({ rows, reviewable = true }: { rows: Row[]; reviewable?: boolean }) {
  return (
    <ul className="divide-y divide-slate-100">
      {rows.map(({ type, doc }) => {
        const url = doc ? `/api/docs/${doc.fileKey}` : null;
        return (
          <li key={type.key} className="flex flex-wrap items-center gap-3 py-3">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-slate-50 text-xs text-slate-400">
              {doc && url ? (doc.mime === "application/pdf" ? <a href={url} target="_blank" rel="noreferrer" className="font-semibold text-red-600">PDF</a> : (
                <a href={url} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element -- archivo privado, no pasa por el optimizador */}
                  <img src={url} alt={type.name} className="h-14 w-14 object-cover" /></a>
              )) : "—"}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{type.name}{type.required && <span className="text-red-500"> *</span>}</p>
              {doc ? (
                <p className="text-xs text-slate-500">
                  <span className={`mr-1 rounded-full px-2 py-0.5 font-medium ${TONE[doc.status]}`}>{LABEL[doc.status]}</span>
                  {doc.uploadedAt.toLocaleDateString("es-MX", { timeZone: "America/Mexico_City" })}
                  {doc.comment && <> · {doc.comment}</>}
                </p>
              ) : <p className="text-xs text-amber-700">No lo ha subido</p>}
            </div>
            {doc && reviewable && <DocReview docId={doc.id} status={doc.status} />}
          </li>
        );
      })}
    </ul>
  );
}
