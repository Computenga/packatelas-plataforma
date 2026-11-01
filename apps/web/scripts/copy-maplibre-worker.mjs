// Copia el worker de MapLibre a public/ para cargarlo con setWorkerUrl: el empaquetador no
// resuelve la URL relativa que usa la librería y el mapa se quedaba en blanco.
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const dist = join(dirname(require.resolve("maplibre-gl/package.json")), "dist");
mkdirSync("public/maplibre", { recursive: true });
copyFileSync(join(dist, "maplibre-gl-worker.mjs"), "public/maplibre/maplibre-gl-worker.mjs");
console.log("maplibre worker → public/maplibre/maplibre-gl-worker.mjs");
