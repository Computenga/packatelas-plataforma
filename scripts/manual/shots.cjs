// Capturas del manual (/ayuda) con datos ficticios de una base local. Uso:
//   node scripts/manual/shots.cjs <salida> [filtro]
const { chromium, devices } = require("playwright");
const BASE = process.env.BASE ?? "http://localhost:3100";
const OUT = process.argv[2];
const ONLY = process.argv[3];
const HIDE = `nextjs-portal, [data-nextjs-toast], [data-next-badge-root] { display: none !important; }`;

const phone = { ...devices["Pixel 7"], deviceScaleFactor: 2 };
const desk = { viewport: { width: 1366, height: 860 }, deviceScaleFactor: 1.5 };

// [usuario, archivo, ruta, dispositivo, acción opcional]
const SHOTS = require("./shots-list.cjs");

async function login(browser, user, dev) {
  const ctx = await browser.newContext({ ...dev, locale: "es-MX", timezoneId: "America/Mexico_City", geolocation: { latitude: 19.3884, longitude: -99.1857 }, permissions: ["geolocation"] });
  await ctx.addInitScript(() => { try { localStorage.setItem("pk-tour-done", "1"); localStorage.setItem("pk-push-dismissed", "1"); } catch {} });
  if (user) {
    const p = await ctx.newPage();
    await p.goto(`${BASE}/login`);
    await p.fill('input[name="username"]', user);
    await p.fill('input[name="password"]', "packatelas");
    await p.click('form button[type="submit"]');
    await p.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60000 });
    await p.close();
  }
  return ctx;
}

(async () => {
  const browser = await chromium.launch();
  const ctxs = {};
  for (const [user, file, path, devName, act] of SHOTS) {
    if (ONLY && !file.includes(ONLY)) continue;
    const dev = devName === "phone" ? phone : desk;
    const key = `${user}-${devName}`;
    ctxs[key] ??= await login(browser, user, dev);
    const page = await ctxs[key].newPage();
    try {
      await page.goto(`${BASE}${path}`, { waitUntil: "networkidle", timeout: 90000 });
      await page.addStyleTag({ content: HIDE });
      if (act) await act(page);
      await page.waitForTimeout(600);
      await page.screenshot({ path: `${OUT}/${file}.png` });
      console.log("ok", file);
    } catch (e) {
      console.log("ERR", file, e.message.split("\n")[0]);
    } finally {
      await page.close();
    }
  }
  await browser.close();
})();
