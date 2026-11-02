// Avisos push a las tiendas (portal cliente y app): gratis, así que se avisa de todo lo que la tienda
// elija en «Mis avisos». El proceso en segundo plano revisa cada ~20 s lo nuevo (eventos de pedidos,
// abonos, facturas, recolecciones en pausa, cuentas de ML) y lo manda a los usuarios de esa tienda.
import type { PrismaClient } from "../generated/prisma/client.ts";
import { sendPush, type PushMessage } from "./push.ts";

export type ClientPushEvent = "recibido" | "en_ruta" | "entregado" | "no_entregado" | "regresa" | "recoleccion" | "pago" | "saldo" | "factura" | "ml_cuenta" | "resumen" | "soporte";

export const CLIENT_PUSH_EVENTS: { key: ClientPushEvent; label: string; hint: string; default: boolean }[] = [
  { key: "soporte", label: "Ayuda y soporte", hint: "Cuando respondemos o resolvemos uno de tus reportes", default: true },
  { key: "entregado", label: "Entregado", hint: "Cuando entregamos un envío (con la foto de evidencia)", default: true },
  { key: "no_entregado", label: "No entregado", hint: "Si no se pudo entregar y por qué", default: true },
  { key: "regresa", label: "Regresa a tu tienda", hint: "Cuando un envío va de regreso contigo", default: true },
  { key: "recoleccion", label: "Recolecciones", hint: "Asignada, en camino y cuántos paquetes recogimos", default: true },
  { key: "pago", label: "Pagos aplicados", hint: "Cada abono que se aplica a tu saldo", default: true },
  { key: "saldo", label: "Recolección en pausa por saldo", hint: "Si tu saldo no alcanza para recolectar", default: true },
  { key: "factura", label: "Facturas", hint: "Cuando tu factura está lista para descargar", default: true },
  { key: "ml_cuenta", label: "Cuenta de Mercado Libre desconectada", hint: "Para que la vuelvas a conectar", default: true },
  { key: "resumen", label: "Resumen del día", hint: "A las 8 pm: recibidos, entregados y no entregados", default: true },
  { key: "recibido", label: "Paquete recibido", hint: "Cada paquete que escaneamos y su cargo (muchos avisos si envías bastante)", default: false },
  { key: "en_ruta", label: "Salió a ruta", hint: "Cada paquete que sale a entrega (muchos avisos si envías bastante)", default: false },
];

export type ClientPushPrefs = Record<ClientPushEvent, boolean>;

export function clientPushPrefs(raw: unknown): ClientPushPrefs {
  const v = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<string, unknown>>;
  return Object.fromEntries(CLIENT_PUSH_EVENTS.map((e) => [e.key, typeof v[e.key] === "boolean" ? (v[e.key] as boolean) : e.default])) as ClientPushPrefs;
}

/** Manda el aviso a los usuarios de la tienda que tienen prendido ese tipo. */
export async function notifyClient(prisma: PrismaClient, clientId: string, event: ClientPushEvent, msg: PushMessage) {
  const users = await prisma.user.findMany({ where: { clientId, role: "CLIENTE", active: true }, select: { id: true, notifyPrefs: true } });
  const ids = users.filter((u) => clientPushPrefs(u.notifyPrefs)[event]).map((u) => u.id);
  if (ids.length) await sendPush(prisma, ids, msg);
  return ids.length;
}

const KEY = "clientpush.cursor";
type Cursor = { events: string; ledger: string; invoices: string; blocked: string; ml: string; summaryOn?: string };
const money = (n: number) => new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(n);
const first = (s?: string | null) => (s ?? "").trim().split(/\s+/)[0] || "";

/** Una vuelta: manda lo nuevo desde la última revisión. Devuelve cuántos avisos salieron. */
export async function processClientPush(prisma: PrismaClient, now = new Date()) {
  const row = await prisma.setting.findUnique({ where: { key: KEY } });
  const iso = now.toISOString();
  // Primera vez: arranca desde ahora (no se avisa lo viejo).
  const c: Cursor = (row?.value as Cursor | undefined) ?? { events: iso, ledger: iso, invoices: iso, blocked: iso, ml: iso };
  let sent = 0;
  const next: Cursor = { ...c };

  // 1) Eventos de pedidos y recolecciones
  const events = await prisma.orderEvent.findMany({
    where: { recordedAt: { gt: new Date(c.events) }, type: { in: ["created", "scanned_loaded", "delivered", "failed", "return_required", "ml_status", "assigned", "pickup_en_route", "picked_up", "pickup_failed"] } },
    orderBy: { recordedAt: "asc" },
    take: 500,
    include: { order: { select: { id: true, code: true, kind: true, source: true, clientId: true, status: true, recipientName: true, driver: { select: { user: { select: { name: true } } } } } } },
  });
  for (const e of events) {
    next.events = e.recordedAt.toISOString();
    const o = e.order;
    if (o.source === "IMPORT") continue;
    const url = o.kind === "PICKUP" ? "/cliente/recolecciones" : `/cliente/envio/${o.id}`;
    const driver = first(o.driver?.user.name);
    let ev: ClientPushEvent | null = null;
    let m: PushMessage | null = null;
    if (o.kind === "PICKUP") {
      ev = "recoleccion";
      if (e.type === "assigned") m = { title: "Recolección asignada", body: `${o.code}: la recoge ${driver || "un repartidor"}` };
      else if (e.type === "pickup_en_route") m = { title: "Tu recolección va en camino", body: `${driver || "El repartidor"} va a recoger tus paquetes (${o.code})` };
      else if (e.type === "picked_up") {
        const n = (e.data as { count?: number } | null)?.count;
        m = { title: "Paquetes recolectados", body: `${o.code}: ${driver || "el repartidor"} recogió ${n != null ? `${n} paquete(s)` : "tus paquetes"}` };
      } else if (e.type === "pickup_failed") m = { title: "No se pudo recolectar", body: `${o.code}${e.note ? ` · ${e.note}` : ""}` };
    } else if (e.type === "created") {
      ev = "recibido";
      const charge = await prisma.ledgerEntry.findFirst({ where: { orderId: o.id, type: "CHARGE" }, select: { amount: true } });
      m = { title: "Paquete recibido", body: `${o.code}${charge ? ` · cargo ${money(Number(charge.amount))}` : ""}` };
    } else if (e.type === "scanned_loaded") {
      ev = "en_ruta";
      m = { title: "Salió a ruta", body: `${o.code} va con ${driver || "nuestro repartidor"}` };
    } else if (e.type === "delivered" || (e.type === "ml_status" && (e.data as { status?: string } | null)?.status === "delivered" && o.status !== "DELIVERED")) {
      ev = "entregado";
      m = { title: "Envío entregado", body: `${o.code}${o.recipientName ? ` · ${o.recipientName}` : ""}` };
    } else if (e.type === "failed") {
      ev = "no_entregado";
      m = { title: "No se pudo entregar", body: `${o.code}${e.note ? `: ${e.note.split(" · ")[0]}` : ""}` };
    } else if (e.type === "return_required") {
      ev = "regresa";
      m = { title: "Regresa a tu tienda", body: `${o.code}${e.note ? `: ${e.note.split(" · ")[0]}` : ""}` };
    }
    if (ev && m) sent += await notifyClient(prisma, o.clientId, ev, { ...m, url, tag: `${ev}-${o.id}` });
  }

  // 2) Abonos aplicados
  const pays = await prisma.ledgerEntry.findMany({ where: { type: "PAYMENT", createdAt: { gt: new Date(c.ledger) } }, orderBy: { createdAt: "asc" }, take: 200 });
  for (const p of pays) {
    next.ledger = p.createdAt.toISOString();
    const bal = await prisma.ledgerEntry.aggregate({ where: { clientId: p.clientId }, _sum: { amount: true } });
    const b = Number(bal._sum.amount ?? 0);
    sent += await notifyClient(prisma, p.clientId, "pago", {
      title: "Pago aplicado",
      body: `Abonamos ${money(Math.abs(Number(p.amount)))} · ${b > 0 ? `debes ${money(b)}` : b < 0 ? `saldo a favor ${money(-b)}` : "estás al corriente"}`,
      url: "/cliente/cuenta", tag: `pago-${p.id}`,
    });
  }

  // 3) Facturas timbradas
  const invs = await prisma.invoice.findMany({ where: { status: "ISSUED", issuedAt: { gt: new Date(c.invoices) } }, orderBy: { issuedAt: "asc" }, take: 200 });
  for (const i of invs) {
    next.invoices = i.issuedAt!.toISOString();
    sent += await notifyClient(prisma, i.clientId, "factura", { title: "Factura lista", body: `Factura ${i.folio ?? ""} por ${money(Number(i.total))} lista para descargar`.replace("  ", " "), url: "/cliente/facturas", tag: `factura-${i.id}` });
  }

  // 4) Recolecciones en pausa por saldo (una vez por tienda por vuelta)
  const blocked = await prisma.pickup.findMany({ where: { status: "BLOCKED", updatedAt: { gt: new Date(c.blocked) } }, orderBy: { updatedAt: "asc" }, take: 200, select: { clientId: true, updatedAt: true } });
  for (const cid of new Set(blocked.map((b) => b.clientId))) {
    sent += await notifyClient(prisma, cid, "saldo", { title: "Recolección en pausa", body: "Tu saldo no alcanza para recolectar. Paga con tu referencia para reactivarla.", url: "/cliente/cuenta", tag: "saldo" });
  }
  if (blocked.length) next.blocked = blocked.at(-1)!.updatedAt.toISOString();

  // 5) Cuentas de Mercado Libre que perdieron el permiso
  const ml = await prisma.mlAccount.findMany({ where: { status: { in: ["TOKEN_EXPIRED", "REVOKED"] }, updatedAt: { gt: new Date(c.ml) } }, orderBy: { updatedAt: "asc" }, take: 200 });
  for (const a of ml) {
    next.ml = a.updatedAt.toISOString();
    sent += await notifyClient(prisma, a.clientId, "ml_cuenta", { title: "Vuelve a conectar Mercado Libre", body: `${a.nickname} se desconectó: sin eso no vemos la dirección de tus envíos.`, url: "/cliente/mercadolibre", tag: `ml-${a.id}` });
  }

  // 6) Resumen del día a las 20:00 (hora de México)
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(now);
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Mexico_City", hour: "numeric", hourCycle: "h23" }).format(now));
  if (hour >= 20 && c.summaryOn !== ymd) {
    next.summaryOn = ymd;
    sent += await dailySummaries(prisma, ymd);
  }

  await prisma.setting.upsert({ where: { key: KEY }, update: { value: next }, create: { key: KEY, value: next } });
  return sent;
}

async function dailySummaries(prisma: PrismaClient, ymd: string) {
  const from = new Date(`${ymd}T06:00:00.000Z`); // 00:00 en CDMX
  const to = new Date(from.getTime() + 86400_000);
  const rows = await prisma.$queryRaw<{ clientId: string; recibidos: number; entregados: number; fallidos: number }[]>`
    SELECT o."clientId",
      COUNT(*) FILTER (WHERE e.type = 'created')::int AS recibidos,
      COUNT(*) FILTER (WHERE e.type = 'delivered')::int AS entregados,
      COUNT(*) FILTER (WHERE e.type = 'failed')::int AS fallidos
    FROM "OrderEvent" e JOIN "Order" o ON o.id = e."orderId"
    WHERE e."occurredAt" >= ${from} AND e."occurredAt" < ${to} AND o.kind = 'DELIVERY' AND o.source <> 'IMPORT'
      AND e.type IN ('created', 'delivered', 'failed')
    GROUP BY o."clientId"`;
  let sent = 0;
  for (const r of rows) {
    if (!r.recibidos && !r.entregados && !r.fallidos) continue;
    sent += await notifyClient(prisma, r.clientId, "resumen", {
      title: "Tu resumen de hoy",
      body: `${r.recibidos} recibido(s) · ${r.entregados} entregado(s) · ${r.fallidos} no entregado(s)`,
      url: "/cliente", tag: `resumen-${ymd}`,
    });
  }
  return sent;
}
