import { admsCommands, admsContact, prisma } from "@packatelas/db";
import { clientIp, text } from "@/lib/iclock";

/**
 * El reloj pregunta si hay comandos pendientes. Solo se le mandan altas de empleados que no tiene
 * (nunca se modifica ni se borra un usuario que ya exista en el aparato).
 */
export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const { sn, allowed } = await admsContact(prisma, sp.get("SN"), clientIp(request), sp.get("INFO") ?? undefined);
  if (!sn || !allowed) return text("OK");
  const cmds = await admsCommands(prisma, sn).catch((e) => { console.error(`[zkteco ${sn}] comandos`, e); return []; });
  return text(cmds.length ? cmds.join("\n") : "OK");
}
