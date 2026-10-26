"use client";

import { useEffect, useRef } from "react";
import "maplibre-gl/dist/maplibre-gl.css";

const STYLE = "https://tiles.openfreemap.org/styles/liberty";

/** Mapa del seguimiento: destino y, si va en camino, la última posición del repartidor. */
export function TrackMap({ dest, driver }: { dest: { lat: number; lng: number } | null; driver: { lat: number; lng: number } | null }) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let map: import("maplibre-gl").Map | null = null;
    let disposed = false;
    (async () => {
      const lib = await import("maplibre-gl");
      if (disposed || !el.current) return;
      const center = driver ?? dest ?? { lat: 19.4326, lng: -99.1332 };
      map = new lib.Map({ container: el.current, style: STYLE, center: [center.lng, center.lat], zoom: 13, attributionControl: { compact: true } });
      const pin = (color: string, label: string) => {
        const d = document.createElement("div");
        d.style.cssText = `width:18px;height:18px;border-radius:9999px;background:${color};border:3px solid white;box-shadow:0 1px 4px rgba(0,0,0,.4)`;
        d.title = label;
        return d;
      };
      if (dest) new lib.Marker({ element: pin("#0f172a", "Destino") }).setLngLat([dest.lng, dest.lat]).addTo(map);
      if (driver) new lib.Marker({ element: pin("#16a34a", "Repartidor") }).setLngLat([driver.lng, driver.lat]).addTo(map);
      if (dest && driver) {
        const b = new lib.LngLatBounds([dest.lng, dest.lat], [dest.lng, dest.lat]).extend([driver.lng, driver.lat]);
        map.fitBounds(b, { padding: 50, maxZoom: 15, duration: 0 });
      }
    })();
    return () => {
      disposed = true;
      map?.remove();
    };
  }, [dest, driver]);
  return <div ref={el} className="h-64 w-full overflow-hidden rounded-xl bg-slate-100" />;
}
