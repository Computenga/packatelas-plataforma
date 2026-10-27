import { getAdmsConfig, prisma } from "@packatelas/db";
import { ActionForm } from "@/components/action-form";
import { Badge, Card } from "@/components/ui";
import { fecha } from "@/lib/format";
import { admsConfigAction, forgetDeviceAction } from "./actions";

/** Recepción directa del checador ZKTeco por ADMS [A23]. Apagada hasta que el admin la active. */
export async function AdmsCard() {
  const c = await getAdmsConfig(prisma);
  const host = (process.env.PUBLIC_URL ?? "https://nuevo.packatelas.mx").replace(/^https?:\/\//, "").replace(/\/$/, "");
  const devices = Object.entries(c.devices).sort((a, b) => b[1].lastAt.localeCompare(a[1].lastAt));
  return (
    <Card title="Recepción directa del ZKTeco" actions={<Badge tone={c.enabled ? "green" : "gray"}>{c.enabled ? "Activa" : "Apagada"}</Badge>}>
      <p className="text-sm text-slate-600">
        El reloj puede mandar cada checada al momento, sin exportar archivos. Mientras esté apagada no se guarda nada y el reloj sigue funcionando igual.
      </p>
      <ActionForm action={admsConfigAction} submitLabel="Guardar">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="enabled" defaultChecked={c.enabled} /> Recibir checadas del reloj</label>
        <label className="block text-sm">Número(s) de serie autorizados
          <input name="serials" defaultValue={c.serials.join(", ")} placeholder="Ej. CQZ7224460123" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono" />
        </label>
        <label className="block text-sm">IP pública de la oficina (desde donde llama el reloj)
          <input name="ips" defaultValue={c.ips.join(", ") || (devices[0]?.[1].ip ?? "")} placeholder="Ej. 189.203.10.20" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono" />
          <span className="mt-1 block text-xs text-slate-500">El número de serie viene impreso en el reloj; la IP evita que alguien de fuera mande checadas falsas.</span>
        </label>
      </ActionForm>
      {devices.length > 0 && (
        <ul className="mt-4 divide-y divide-slate-100 text-sm">
          {devices.map(([sn, d]) => (
            <li key={sn} className="py-1.5">
              <span className="font-mono">{sn}</span> {c.serials.includes(sn) ? <Badge tone="green">autorizado</Badge> : <Badge tone="amber">sin autorizar</Badge>}
              {!c.serials.includes(sn) && (
                <form action={forgetDeviceAction.bind(null, sn)} className="ml-2 inline"><button className="text-xs text-red-600 hover:underline">Quitar</button></form>
              )}
              <span className="block text-xs text-slate-500">
                Último contacto {fecha(new Date(d.lastAt))}{d.ip ? ` desde ${d.ip}` : ""} · {d.punches} checada(s) recibidas{d.lastPunchAt ? ` · última ${fecha(new Date(d.lastPunchAt))}` : ""}
                {d.rejected ? ` · ${d.rejected} descartadas por fecha inválida` : ""}
                {d.ip && c.serials.includes(sn) && !c.ips.includes(d.ip) ? " · Atención: llama desde una IP no permitida" : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
      <details className="mt-4 text-sm text-slate-600">
        <summary className="cursor-pointer">Cómo configurar el reloj (el día que se decida)</summary>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>En el reloj: Menú → Comunicación (COMM) → Servidor en la nube / ADMS.</li>
          <li>Dirección del servidor: <code>{host}</code> · Puerto: <code>443</code> · HTTPS: activado. Proxy: no.</li>
          <li>Guarda y reinicia el reloj. En 1–2 minutos aparece aquí su número de serie como “sin autorizar”.</li>
          <li>Copia ese número y la IP que aparece junto a él arriba, marca “Recibir checadas” y guarda. El reloj manda su historial y después cada checada al momento; las repetidas se ignoran.</li>
          <li>Si el modelo no tiene HTTPS, avísale a soporte: hay que abrir una entrada HTTP solo para /iclock.</li>
        </ol>
        <p className="mt-2 text-xs">Solo se leen checadas: la plataforma nunca manda comandos al reloj ni cambia sus usuarios. La exportación por archivo sigue funcionando igual.</p>
      </details>
    </Card>
  );
}
