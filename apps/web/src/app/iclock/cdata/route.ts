import { admsContact, admsOptions, admsReceiveAttlog, admsReceiveUsers, prisma } from "@packatelas/db";
import { clientIp, readCapped, text } from "@/lib/iclock";

// Protocolo ADMS del ZKTeco [A23]. Apagado hasta activarlo en Admin → Checador.

/** Saludo del reloj: pide la configuración de envío. */
export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const { sn, allowed } = await admsContact(prisma, sp.get("SN"), clientIp(request), sp.get("pushver") ? `pushver ${sp.get("pushver")}` : undefined);
  if (!sn) return text("Falta SN", 400);
  return allowed ? text(admsOptions(sn)) : text("OK");
}

/** El reloj manda checadas (ATTLOG) u otras tablas (usuarios, operaciones) que solo se confirman. */
export async function POST(request: Request) {
  const sp = new URL(request.url).searchParams;
  const { sn, allowed } = await admsContact(prisma, sp.get("SN"), clientIp(request));
  if (!sn) return text("Falta SN", 400);
  const body = await readCapped(request, 2_000_000);
  if (body === null) return text("Demasiado grande", 413);
  const lines = body.split(/\r?\n/).filter((l) => l.trim()).length;
  if (!allowed) return text(`OK: ${lines}`); // se confirma para que no reintente, pero no se guarda
  if ((sp.get("table") ?? "").toUpperCase() === "ATTLOG") {
    const r = await admsReceiveAttlog(prisma, sn, body);
    if (r.unknownEmployees.length) console.warn(`[zkteco ${sn}] Números sin empleado: ${r.unknownEmployees.join(", ")}`);
    return text(`OK: ${r.received}`);
  }
  // Lista de usuarios del reloj (respuesta a la consulta que se le pide antes de dar altas).
  await admsReceiveUsers(prisma, sn, body).catch((e) => console.error(`[zkteco ${sn}] usuarios`, e));
  return text(`OK: ${lines}`);
}
