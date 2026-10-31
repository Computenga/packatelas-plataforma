import type { StyleSpecification } from "maplibre-gl";

/**
 * Mapa base en mosaicos raster de CARTO (datos de OpenStreetMap). Carga en cualquier celular,
 * incluso sin WebGL potente, y no depende del servidor de estilos vectoriales que fallaba.
 */
export const MAP_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    base: {
      type: "raster",
      tiles: ["a", "b", "c", "d"].map((s) => `https://${s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png`),
      tileSize: 256,
      maxzoom: 20,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · © <a href="https://carto.com/attributions">CARTO</a>',
    },
  },
  layers: [{ id: "base", type: "raster", source: "base" }],
};
