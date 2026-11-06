import { admsCommandResults, admsContact, prisma } from "@packatelas/db";
import { clientIp, readCapped, text } from "@/lib/iclock";

/** El reloj confirma los comandos que ejecutó (altas de empleados, consulta de usuarios). */
export async function POST(request: Request) {
  const sp = new URL(request.url).searchParams;
  const { sn, allowed } = await admsContact(prisma, sp.get("SN"), clientIp(request));
  const body = await readCapped(request, 200_000);
  if (sn && allowed && body) await admsCommandResults(prisma, sn, body).catch((e) => console.error(`[zkteco ${sn}] resultados`, e));
  return text("OK");
}
