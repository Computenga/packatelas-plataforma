import { mlConfig, prisma, signMlState } from "@packatelas/db";
import { CopyLink } from "./copy-link";

const LABEL = { ACTIVE: "Conectada", TOKEN_EXPIRED: "Sin autorizar", REVOKED: "Revocada", DISABLED: "Desactivada" } as const;
const TONE = { ACTIVE: "text-emerald-700", TOKEN_EXPIRED: "text-amber-700", REVOKED: "text-red-700", DISABLED: "text-slate-500" } as const;

/** Conectar cuentas de MercadoLibre por OAuth [I02]. `self`: el propio cliente desde su portal. */
export async function MlConnect({ clientId, self = false }: { clientId: string; self?: boolean }) {
  const accounts = await prisma.mlAccount.findMany({ where: { clientId }, select: { id: true, nickname: true, mlUserId: true, status: true }, orderBy: { nickname: "asc" } });
  const configured = !!mlConfig();
  const path = `/ml/conectar?s=${encodeURIComponent(signMlState(clientId))}`;
  return (
    <div className="space-y-3 text-sm">
      {accounts.length > 0 && (
        <ul className="divide-y divide-slate-100">
          {accounts.map((a) => (
            <li key={a.id} className="flex justify-between gap-2 py-1.5">
              <span>{a.nickname} <span className="font-mono text-xs text-slate-400">{a.mlUserId.toString()}</span></span>
              <span className={`text-xs font-medium ${TONE[a.status]}`}>{LABEL[a.status]}</span>
            </li>
          ))}
        </ul>
      )}
      {!configured ? (
        <p className="text-slate-500">La conexión con MercadoLibre aún no está configurada.</p>
      ) : self ? (
        <>
          <p className="text-slate-600">Entra con tu cuenta de MercadoLibre y autoriza a Packatelas para que tus envíos lleguen con destinatario y dirección. Si tienes varias cuentas, hazlo con cada una.</p>
          <a href={path} className="inline-block rounded-lg bg-[#ffe600] px-4 py-2 font-semibold text-slate-900">Conectar con MercadoLibre</a>
        </>
      ) : (
        <>
          <p className="text-slate-600">Manda este enlace al cliente: entra con su cuenta de MercadoLibre y autoriza. Vale 7 días y sirve para varias cuentas.</p>
          <div className="flex flex-wrap gap-2">
            <CopyLink path={path} label="Copiar enlace de conexión" text="Conecta tu cuenta de MercadoLibre con Packatelas:" />
            <a href={path} target="_blank" rel="noreferrer" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium">Abrir</a>
          </div>
        </>
      )}
    </div>
  );
}
