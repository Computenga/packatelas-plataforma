import type { StyleSpecification } from "maplibre-gl";

/**
 * Mapa base vectorial de OpenFreeMap (datos de OpenStreetMap, gratis y sin llave). Antes se veía
 * en blanco porque el worker de MapLibre no cargaba; ahora se sirve desde /maplibre.
 */
export const MAP_STYLE: StyleSpecification | string = "https://tiles.openfreemap.org/styles/liberty";

type MapLib = typeof import("maplibre-gl");
let workerSet = false;
/** Carga maplibre con su worker servido desde /maplibre (ver scripts/copy-maplibre-worker.mjs). */
export async function loadMapLibre(): Promise<MapLib> {
  const lib = await import("maplibre-gl");
  if (!workerSet) {
    lib.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");
    workerSet = true;
  }
  return lib;
}
