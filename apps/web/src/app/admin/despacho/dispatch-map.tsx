"use client";

// Mapa en vivo de despacho [A07]: pedidos (gris = sin asignar, color = repartidor) y
// posición de cada repartidor.
import { useEffect, useRef, useState } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import type { BoardDriver, BoardOrder } from "./board";

const STYLE = "https://tiles.openfreemap.org/styles/liberty";

type ML = typeof import("maplibre-gl");

export function DispatchMap({ orders, drivers, colorOf, selected, onToggle }: {
  orders: BoardOrder[];
  drivers: BoardDriver[];
  colorOf: Map<string, string>;
  selected: Set<string>;
  onToggle: (id: string) => void;
}) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<InstanceType<ML["Map"]> | null>(null);
  const libRef = useRef<ML | null>(null);
  const markers = useRef<InstanceType<ML["Marker"]>[]>([]);
  const fitted = useRef(false);
  const [ready, setReady] = useState(false);
  const onToggleRef = useRef(onToggle);
  useEffect(() => {
    onToggleRef.current = onToggle;
  }, [onToggle]);

  useEffect(() => {
    let disposed = false;
    (async () => {
      const lib = await import("maplibre-gl");
      if (disposed || !el.current) return;
      libRef.current = lib;
      const map = new lib.Map({ container: el.current, style: STYLE, center: [-99.1332, 19.4326], zoom: 10 });
      map.addControl(new lib.NavigationControl({ showCompass: false }), "top-right");
      mapRef.current = map;
      map.on("load", () => map.resize());
      setReady(true);
    })();
    return () => {
      disposed = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const lib = libRef.current;
    if (!ready || !map || !lib) return;
    markers.current.forEach((m) => m.remove());
    markers.current = [];
    const bounds = new lib.LngLatBounds();

    for (const o of orders) {
      if (o.lat == null || o.lng == null) continue;
      const dot = document.createElement("button");
      const color = o.driverId && (o.status === "ASSIGNED" || o.status === "OUT_FOR_DELIVERY") ? colorOf.get(o.driverId) ?? "#64748b" : "#94a3b8";
      const isSel = selected.has(o.id);
      dot.type = "button";
      dot.title = `${o.code} · ${o.address}`;
      dot.style.cssText = `width:${isSel ? 18 : 14}px;height:${isSel ? 18 : 14}px;border-radius:9999px;background:${color};border:${isSel ? "3px solid #f5b301" : "2px solid white"};box-shadow:0 1px 3px rgba(0,0,0,.4);cursor:pointer`;
      if (o.status === "OUT_FOR_DELIVERY") dot.style.outline = `2px solid ${color}`;
      dot.addEventListener("click", (ev) => {
        ev.stopPropagation();
        onToggleRef.current(o.id);
      });
      markers.current.push(new lib.Marker({ element: dot }).setLngLat([o.lng, o.lat]).addTo(map));
      bounds.extend([o.lng, o.lat]);
    }

    for (const d of drivers) {
      if (d.lat == null || d.lng == null) continue;
      const badge = document.createElement("div");
      const initials = d.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
      badge.textContent = initials;
      badge.title = d.name;
      badge.style.cssText = `width:30px;height:30px;border-radius:9999px;background:${colorOf.get(d.id)};color:white;font:600 12px system-ui;display:flex;align-items:center;justify-content:center;border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,.35);opacity:${d.onDuty ? 1 : 0.5}`;
      markers.current.push(new lib.Marker({ element: badge }).setLngLat([d.lng, d.lat]).addTo(map));
      bounds.extend([d.lng, d.lat]);
    }

    if (!fitted.current && !bounds.isEmpty()) {
      map.fitBounds(bounds, { padding: 60, maxZoom: 14, duration: 0 });
      fitted.current = true;
    }
  }, [ready, orders, drivers, colorOf, selected]);

  return <div ref={el} className="absolute inset-0" />;
}
