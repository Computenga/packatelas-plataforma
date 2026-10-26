// Service worker de la app del repartidor: permite abrir la app y las páginas ya visitadas
// sin señal. Las acciones (entregas, fallidos) viajan por la cola en IndexedDB, no por aquí.
const CACHE = "pk-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Archivos estáticos con huella: primero caché.
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icon-")) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
            return res;
          }),
      ),
    );
    return;
  }

  // Páginas del repartidor: primero red; sin señal, la última copia guardada.
  if (req.mode === "navigate" && url.pathname.startsWith("/repartidor")) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() =>
          caches.match(req).then(
            (hit) =>
              hit ||
              caches.match("/repartidor") ||
              new Response("<h1>Sin señal</h1><p>Abre esta página cuando tengas conexión.</p>", {
                headers: { "Content-Type": "text/html; charset=utf-8" },
              }),
          ),
        ),
    );
  }
});
