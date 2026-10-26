import { admsContact, prisma } from "@packatelas/db";
import { clientIp, text } from "@/lib/iclock";

/** El reloj pregunta si hay comandos pendientes; nunca le mandamos comandos (no se modifica el aparato). */
export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  await admsContact(prisma, sp.get("SN"), clientIp(request), sp.get("INFO") ?? undefined);
  return text("OK");
}
