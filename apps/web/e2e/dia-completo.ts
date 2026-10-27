// Prueba de punta a punta de un día de operación, con los usuarios de prueba del seed.
// Se corre contra un servidor local (nunca producción) antes de cada cambio grande (requiere
// Playwright instalado en la máquina, no en la imagen del servidor):
//   DATABASE_URL=postgresql://…/packatelas BASE=http://127.0.0.1:3100 npx tsx e2e/dia-completo.ts
// Recorre: cliente crea envíos → despacho asigna → repartidor carga, entrega con foto y falla
// → operador recibe la devolución → cobros (cargo automático y abono) → informes y nómina.
import { chromium, type Browser, type Page } from "playwright";
import { prisma } from "@packatelas/db";

const BASE = process.env.BASE ?? "http://127.0.0.1:3100";
const PASS = process.env.E2E_PASSWORD ?? "packatelas";
if (/packatelas\.mx/.test(BASE)) throw new Error("Solo contra un servidor local o de pruebas");

const fails: string[] = [];
function check(ok: boolean, msg: string) {
  console.log(`${ok ? "ok  " : "FALLA"} ${msg}`);
  if (!ok) fails.push(msg);
}

// JPEG mínimo válido (1×1) para la foto de entrega.
const JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==",
  "base64",
);

async function login(browser: Browser, user: string): Promise<Page> {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  await page.goto(`${BASE}/login`);
  await page.fill("input[name=username]", user);
  await page.fill("input[name=password]", PASS);
  await page.click("button[type=submit]");
  await page.waitForLoadState("networkidle");
  return page;
}

async function main() {
  const tag = `E2E${Date.now().toString(36).toUpperCase()}`;
  const cliente = await prisma.user.findUniqueOrThrow({ where: { username: "cliente" }, include: { client: true } });
  const repUser = await prisma.user.findUniqueOrThrow({ where: { username: "repartidor" }, include: { driver: true } });
  const clientId = cliente.clientId!;
  const balance0 = Number((await prisma.ledgerEntry.aggregate({ where: { clientId }, _sum: { amount: true } }))._sum.amount ?? 0);
  const browser = await chromium.launch();
  const created: string[] = [];

  try {
    // 1) Cliente: dos envíos desde su portal.
    const c = await login(browser, "cliente");
    for (const [i, name] of [`${tag} Entrega`, `${tag} Falla`].entries()) {
      await c.goto(`${BASE}/cliente/nuevo`);
      await c.fill("input[name=recipientName]", name);
      await c.fill("input[name=recipientPhone]", "5512345678");
      await c.fill("input[name=addressLine]", `Calle Ficticia ${100 + i}`);
      await c.click("button:has-text('Registrar envío')");
      await c.waitForURL(/\/cliente\/envio\//);
      created.push(c.url().split("/cliente/envio/")[1].split("?")[0]);
    }
    const orders = await prisma.order.findMany({ where: { id: { in: created } } });
    check(orders.length === 2 && orders.every((o) => o.status === "CREATED"), "cliente registra 2 envíos");
    const charged = Number((await prisma.ledgerEntry.aggregate({ where: { clientId }, _sum: { amount: true } }))._sum.amount ?? 0) - balance0;
    check(charged > 0, `cargo automático al cliente (${charged.toFixed(2)})`);
    // Ubicación fija para que entren al mapa de despacho.
    await prisma.order.updateMany({ where: { id: { in: created } }, data: { lat: 19.43, lng: -99.13 } });

    // 2) Repartidor inicia turno; despacho asigna los dos.
    const r = await login(browser, "repartidor");
    await r.goto(`${BASE}/repartidor`);
    if (await r.locator("button:has-text('Iniciar turno')").count()) await r.click("button:has-text('Iniciar turno')");
    await r.waitForSelector("button:has-text('Terminar turno')");
    const d = await login(browser, "despacho");
    await d.goto(`${BASE}/admin/despacho`);
    await d.fill("input[placeholder^='Filtrar']", tag);
    await d.waitForTimeout(500);
    for (const o of orders) await d.locator("label", { hasText: o.code }).locator("input[type=checkbox]").check();
    await d.selectOption("select[aria-label=Repartidor]", repUser.driver!.id);
    await d.click("button:has-text('Asignar')");
    await d.waitForTimeout(1500);
    const assigned = await prisma.order.findMany({ where: { id: { in: created } } });
    check(assigned.every((o) => o.driverId === repUser.driver!.id && o.status === "ASSIGNED"), "despacho asigna al repartidor");

    // 3) Repartidor: carga (escaneo), entrega uno con foto y falla el otro.
    for (const o of orders) {
      await r.goto(`${BASE}/repartidor/escanear`);
      if (await r.locator("button:has-text('PDA')").count()) await r.click("button:has-text('PDA')");
      await r.fill("input[placeholder='Esperando lectura…']", o.code);
      await r.press("input[placeholder='Esperando lectura…']", "Enter");
      await r.waitForTimeout(1500);
      const btn = r.locator("button:has-text('Cargar'), button:has-text('Confirmar carga'), button:has-text('Subir a mi ruta')");
      if (await btn.count()) await btn.first().click();
      await r.waitForTimeout(1500);
    }
    await r.goto(`${BASE}/repartidor`);
    await r.waitForTimeout(1500);
    const loaded = await prisma.order.findMany({ where: { id: { in: created } } });
    check(loaded.every((o) => o.status === "OUT_FOR_DELIVERY"), "repartidor carga los 2 (en camino)");

    const ok = r.locator("li", { hasText: `${tag} Entrega` }).first();
    await ok.locator("button").first().click(); // abre la parada
    await ok.getByRole("button", { name: "Entregado", exact: true }).click();
    await ok.locator("input:not([type=file])").first().fill("Persona Ficticia");
    await ok.locator("input[type=file]").setInputFiles({ name: "foto.jpg", mimeType: "image/jpeg", buffer: JPEG });
    await ok.locator("button:has-text('Confirmar')").click();
    await r.waitForTimeout(1000);
    const bad = r.locator("li", { hasText: `${tag} Falla` }).first();
    await bad.locator("button").first().click();
    await bad.getByRole("button", { name: "No entregado", exact: true }).click();
    await bad.locator("select").selectOption({ index: 0 });
    await bad.locator("button:has-text('Confirmar')").click();
    // La cola sin conexión envía en segundo plano.
    for (let i = 0; i < 20; i++) {
      const s = await prisma.order.findMany({ where: { id: { in: created } }, select: { status: true } });
      if (s.every((x) => x.status !== "OUT_FOR_DELIVERY")) break;
      await r.waitForTimeout(1000);
    }
    const [delivered, failed] = await Promise.all(created.map((id) => prisma.order.findUniqueOrThrow({ where: { id }, include: { evidence: true } })));
    check(delivered.status === "DELIVERED" && delivered.evidence.length === 1, "entregado con foto de evidencia");
    check(["FAILED", "RETURNING", "RESCHEDULED"].includes(failed.status), `no entregado registrado (${failed.status})`);

    // 4) El cliente ve la entrega y la evidencia; el otro cliente no puede verla.
    await c.goto(`${BASE}/cliente/envio/${delivered.id}`);
    check((await c.innerText("main")).includes("Entregado"), "cliente ve su envío entregado");
    const other = await prisma.user.findFirst({ where: { role: "CLIENTE", clientId: { not: clientId } } });
    if (other) {
      // Se le pone una contraseña conocida solo durante la prueba.
      const { hashPassword } = await import("@packatelas/db");
      const prev = other.passwordHash;
      await prisma.user.update({ where: { id: other.id }, data: { passwordHash: await hashPassword(PASS) } });
      try {
        const o = await login(browser, other.username);
        check(o.url().includes("/cliente"), "entra el otro cliente");
        await o.goto(`${BASE}/cliente/envio/${delivered.id}`);
        check(!(await o.innerText("body")).includes(`${tag} Entrega`), "otro cliente no ve el envío");
      } finally {
        await prisma.user.update({ where: { id: other.id }, data: { passwordHash: prev } });
      }
    }

    // 5) Devolución: forzar regreso a bodega y recibirlo con el operador.
    await prisma.order.update({ where: { id: failed.id }, data: { status: "RETURNING" } });
    const op = await login(browser, "operador");
    await op.goto(`${BASE}/admin/devoluciones`);
    if (await op.locator("button:has-text('PDA')").count()) await op.click("button:has-text('PDA')");
    await op.fill("input[placeholder='Esperando lectura…']", failed.code);
    await op.press("input[placeholder='Esperando lectura…']", "Enter");
    await op.waitForTimeout(1500);
    const ret = await prisma.order.findUniqueOrThrow({ where: { id: failed.id }, include: { return: true } });
    check(ret.status === "RETURNED_TO_WAREHOUSE" && ret.return?.status === "IN_WAREHOUSE" && ret.driverId === null, "operador recibe la devolución en bodega");

    // 6) Cobros: abono manual que deja el saldo como estaba.
    const a = await login(browser, "admin");
    await a.goto(`${BASE}/admin/cobros/${clientId}`);
    await a.fill("input[name=amount]", charged.toFixed(2));
    await a.fill("input[name=reference]", tag);
    await a.click("button:has-text('Registrar abono')");
    await a.waitForTimeout(1500);
    const balance1 = Number((await prisma.ledgerEntry.aggregate({ where: { clientId }, _sum: { amount: true } }))._sum.amount ?? 0);
    check(Math.abs(balance1 - balance0) < 0.01, "abono registrado: saldo de vuelta al inicial");

    // 7) Informes y páginas clave cargan sin error.
    for (const path of ["/admin", "/admin/informes", "/admin/informes/tiempos-ruta", "/admin/salud", "/admin/nomina", "/admin/datos", "/admin/arranque"]) {
      const res = await a.goto(`${BASE}${path}`);
      check(res?.status() === 200 && !(await a.innerText("body")).includes("Application error"), `abre ${path}`);
    }

    // 8) Fin de turno.
    await r.goto(`${BASE}/repartidor`);
    await r.click("button:has-text('Terminar turno')");
    await r.waitForTimeout(800);
    check(!(await prisma.driver.findUniqueOrThrow({ where: { id: repUser.driver!.id } })).onDuty, "repartidor termina turno");
  } finally {
    await browser.close();
    // Limpieza de lo creado por la prueba.
    const ids = created;
    await prisma.ledgerEntry.deleteMany({ where: { OR: [{ orderId: { in: ids } }, { description: { contains: tag } }, { payment: { reference: tag } }] } });
    await prisma.payment.deleteMany({ where: { reference: tag } });
    await prisma.evidence.deleteMany({ where: { orderId: { in: ids } } });
    await prisma.notification.deleteMany({ where: { orderId: { in: ids } } });
    await prisma.webhookDelivery.deleteMany({ where: { orderId: { in: ids } } });
    await prisma.order.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
  }
  console.log(fails.length ? `\n${fails.length} FALLA(S): ${fails.join(" | ")}` : "\nTodo el recorrido pasó.");
  process.exit(fails.length ? 1 : 0);
}

void main();
