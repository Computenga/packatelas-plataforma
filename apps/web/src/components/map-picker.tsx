"use client";

// Mapa con pin arrastrable. Teselas gratuitas de OpenFreeMap (OpenStreetMap), sin llave.
import { useEffect, useRef } from "react";
import "maplibre-gl/dist/maplibre-gl.css";

const STYLE = "https://tiles.openfreemap.org/styles/liberty";
const CDMX: [number, number] = [-99.1332, 19.4326];

export function MapPicker({ lat, lng, onChange, className = "" }: {
  lat?: number;
  lng?: number;
  onChange: (lat: number, lng: number) => void;
  className?: string;
}) {
  const el = useRef<HTMLDivElement>(null);
  const api = useRef<{ setPin: (lng: number, lat: number) => void } | null>(null);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    let disposed = false;
    let cleanup = () => {};
    (async () => {
      const { Map, Marker, NavigationControl } = await import("maplibre-gl");
      if (disposed || !el.current) return;
      const has = lat != null && lng != null;
      const map = new Map({ container: el.current, style: STYLE, center: has ? [lng!, lat!] : CDMX, zoom: has ? 16 : 10 });
      map.addControl(new NavigationControl({ showCompass: false }), "top-right");
      const marker = new Marker({ draggable: true, color: "#1f4fa3" });
      let placed = false;
      const setPin = (x: number, y: number) => {
        marker.setLngLat([x, y]);
        if (!placed) {
          marker.addTo(map);
          placed = true;
        }
      };
      if (has) setPin(lng!, lat!);
      marker.on("dragend", () => {
        const p = marker.getLngLat();
        onChangeRef.current(p.lat, p.lng);
      });
      map.on("click", (e) => {
        setPin(e.lngLat.lng, e.lngLat.lat);
        onChangeRef.current(e.lngLat.lat, e.lngLat.lng);
      });
      api.current = {
        setPin: (x, y) => {
          setPin(x, y);
          map.flyTo({ center: [x, y], zoom: 16 });
        },
      };
      cleanup = () => map.remove();
    })();
    return () => {
      disposed = true;
      cleanup();
    };
    // El mapa se crea una vez; los cambios de coordenadas llegan por api.setPin.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (lat != null && lng != null) api.current?.setPin(lng, lat);
  }, [lat, lng]);

  return <div ref={el} className={`h-64 w-full overflow-hidden rounded-lg border border-slate-300 ${className}`} />;
}
