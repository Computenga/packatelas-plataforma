"use client";

import { useEffect, useRef } from "react";
import "maplibre-gl/dist/maplibre-gl.css";

const STYLE = "https://tiles.openfreemap.org/styles/liberty";

/** Mapa de calor de entregas (secuencial de un solo tono: claro = pocas, oscuro = muchas). */
export function HeatMap({ points }: { points: [number, number][] }) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let map: import("maplibre-gl").Map | null = null;
    let disposed = false;
    (async () => {
      const lib = await import("maplibre-gl");
      if (disposed || !el.current) return;
      map = new lib.Map({ container: el.current, style: STYLE, center: [-99.13, 19.43], zoom: 10 });
      map.addControl(new lib.NavigationControl({ showCompass: false }), "top-right");
      map.on("load", () => {
        if (!map) return;
        map.addSource("d", { type: "geojson", data: { type: "FeatureCollection", features: points.map((c) => ({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: c } })) } });
        map.addLayer({
          id: "heat",
          type: "heatmap",
          source: "d",
          paint: {
            "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 9, 8, 14, 24],
            "heatmap-opacity": 0.8,
            "heatmap-color": ["interpolate", ["linear"], ["heatmap-density"], 0, "rgba(219,234,254,0)", 0.2, "#bfdbfe", 0.45, "#60a5fa", 0.7, "#2563eb", 1, "#1e3a8a"],
          },
        });
        if (points.length) {
          const b = new lib.LngLatBounds(points[0], points[0]);
          points.forEach((p) => b.extend(p));
          map.fitBounds(b, { padding: 40, maxZoom: 13, duration: 0 });
        }
      });
    })();
    return () => {
      disposed = true;
      map?.remove();
    };
  }, [points]);
  return <div ref={el} className="h-[480px] w-full overflow-hidden rounded-xl bg-slate-100" />;
}
