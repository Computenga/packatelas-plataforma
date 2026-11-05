// Autoservicio del comprador en la página de rastreo (como Rapiboy): con los últimos 4 dígitos de
// su teléfono puede pedir otra fecha, dejar indicaciones, ver la foto de entrega o reportar un problema.
import type { PrismaClient } from "../generated/prisma/client.ts";
import { addOrderEvent } from "./orders.ts";
import { windowCount } from "./onboarding.ts";
import { sendPush } from "./push.ts";
import { createTicket } from "./helpdesk.ts";

const OPEN = ["CREATED", "ASSIGNED", "OUT_FOR_DELIVERY", "FAILED", "RESCHEDULED"];
const YMD = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" });
const LONG = new Intl.DateTimeFormat("es-MX", { timeZone: "America/Mexico_City", weekday: "long", day: "numeric", month: "long" });
const clean = (s: string, max: number) => s.replace(/\s+/g, " ").trim().slice(0, max);

/** ¿Coinciden los últimos 4 dígitos? Con límite de intentos por envío y por IP. */
export async function buyerVerify(prisma: PrismaClient, orderId: string, last4: string, ip: string) {
  const digits = String(last4).replace(/\D/g, "");
  if (digits.length !== 4) return { ok: false as const, error: "Escribe los últimos 4 dígitos de tu teléfono" };
  const [perOrder, perIp] = await Promise.all([windowCount(prisma, `buyer:${orderId}`, 60), windowCount(prisma, `buyer-ip:${ip}`, 60)]);
  if (perOrder > 6 || perIp > 30) return { ok: false as const, error: "Demasiados intentos. Inténtalo en una hora o escríbenos por WhatsApp." };
  const o = await prisma.order.findUnique({ where: { id: orderId }, select: { recipientPhone: true } });
  const phone = (o?.recipientPhone ?? "").replace(/\D/g, "");
  if (phone.length < 4) return { ok: false as const, error: "Este envío no tiene teléfono registrado; escríbenos por WhatsApp." };
  return phone.endsWith(digits) ? { ok: true as const } : { ok: false as const, error: "Esos dígitos no coinciden con el teléfono del envío" };
}

/** Próximos días hábiles (lunes a sábado) que el comprador puede elegir. */
export function buyerDates(now = new Date(), n = 5) {
  const out: { ymd: string; label: string }[] = [];
  for (let i = 1; out.length < n && i < 14; i++) {
    const d = new Date(now.getTime() + i * 86_400_000);
    const ymd = YMD.format(d);
    if (new Date(`${ymd}T12:00:00-06:00`).getUTCDay() === 0) continue; // domingo
    out.push({ ymd, label: LONG.format(new Date(`${ymd}T12:00:00-06:00`)) });
  }
  return out;
}

async function load(prisma: PrismaClient, orderId: string) {
  return prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, code: true, kind: true, status: true, mlStatus: true, instructions: true, clientId: true, driverId: true, driver: { select: { userId: true } } },
  });
}

async function tell(prisma: PrismaClient, o: { code: string; id: string; driver: { userId: string } | null }, title: string, body: string) {
  const staff = (await prisma.user.findMany({ where: { role: { in: ["ADMIN", "DESPACHADOR"] }, active: true }, select: { id: true } })).map((u) => u.id);
  await sendPush(prisma, staff, { title, body, url: `/admin/pedidos/${o.id}`, tag: `buyer-${o.id}` }).catch(() => null);
  if (o.driver) await sendPush(prisma, [o.driver.userId], { title, body, url: "/repartidor", tag: `buyer-${o.id}` }).catch(() => null);
}

export async function buyerReschedule(prisma: PrismaClient, orderId: string, ymd: string, now = new Date()) {
  const o = await load(prisma, orderId);
  if (!o || o.kind !== "DELIVERY" || !OPEN.includes(o.status) || o.mlStatus === "delivered") throw new Error("Este envío ya no se puede cambiar");
  const ok = buyerDates(now).find((d) => d.ymd === ymd);
  if (!ok) throw new Error("Elige una de las fechas disponibles");
  await prisma.order.update({ where: { id: o.id }, data: { requestedDeliveryAt: new Date(`${ymd}T12:00:00-06:00`) } });
  await addOrderEvent(prisma, { orderId: o.id, type: "buyer_reschedule", source: "SYSTEM", note: `El comprador pidió que se entregue el ${ok.label}` });
  await tell(prisma, o, `📅 ${o.code}: el comprador pidió otra fecha`, `Entregar el ${ok.label}. ${o.driverId ? "No lo intentes antes." : ""}`.trim());
  return ok.label;
}

export async function buyerNote(prisma: PrismaClient, orderId: string, input: { text?: string; receiver?: string }) {
  const o = await load(prisma, orderId);
  if (!o || o.kind !== "DELIVERY" || !OPEN.includes(o.status)) throw new Error("Este envío ya no se puede cambiar");
  const text = clean(input.text ?? "", 300);
  const receiver = clean(input.receiver ?? "", 80);
  if (!text && !receiver) throw new Error("Escribe las indicaciones o quién recibe");
  const add = [receiver && `Recibe: ${receiver}`, text].filter(Boolean).join(". ");
  const instructions = [o.instructions, `Comprador: ${add}`].filter(Boolean).join(" | ").slice(-500);
  await prisma.order.update({ where: { id: o.id }, data: { instructions } });
  await addOrderEvent(prisma, { orderId: o.id, type: "buyer_note", source: "SYSTEM", note: `Indicaciones del comprador: ${add}` });
  if (o.driverId) await tell(prisma, o, `📝 ${o.code}: indicaciones del comprador`, add);
}

export const BUYER_PROBLEMS = [
  { key: "no_llego", label: "Dice entregado y no lo recibí" },
  { key: "danado", label: "Llegó dañado o incompleto" },
  { key: "otro", label: "Otro problema" },
] as const;

/** Reporte del comprador: se abre un reporte de soporte a nombre de la tienda (lo ven la tienda y Packatelas). */
export async function buyerProblem(prisma: PrismaClient, orderId: string, kind: string, text: string) {
  const o = await load(prisma, orderId);
  if (!o) throw new Error("Envío no encontrado");
  const k = BUYER_PROBLEMS.find((p) => p.key === kind);
  if (!k) throw new Error("Elige qué pasó");
  const detail = clean(text, 1500);
  if (detail.length < 10) throw new Error("Cuéntanos un poco más de lo que pasó");
  await addOrderEvent(prisma, { orderId: o.id, type: "buyer_problem", source: "SYSTEM", note: `Reporte del comprador: ${k.label}. ${detail}` });
  const user = await prisma.user.findFirst({ where: { clientId: o.clientId, role: "CLIENTE", active: true }, orderBy: { createdAt: "asc" }, select: { id: true } });
  if (user) {
    await createTicket(prisma, {
      clientId: o.clientId, userId: user.id, category: k.key === "danado" ? "dano" : "envio",
      subject: `Reporte del comprador: ${k.label}`, text: `El comprador reportó desde la página de rastreo: ${detail}`, orderRef: o.code,
    });
  } else {
    await tell(prisma, { ...o, driver: null }, `⚠️ ${o.code}: reporte del comprador`, `${k.label}. ${detail}`);
  }
}
