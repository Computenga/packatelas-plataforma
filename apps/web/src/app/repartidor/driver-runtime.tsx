"use client";

// Procesos de fondo de la app del repartidor mientras la página está abierta:
// cola sin conexión, ubicación en vivo, pantalla encendida y service worker [R10, R11, P04].
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { dismiss, flush, listQueue, onQueueChange, type QueuedEvent } from "@/lib/offline-queue";

const SEND_EVERY_MS = 30_000;

function subscribeOnline(cb: () => void) {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}
const MIN_MOVE_MS = 10_000;

export function DriverRuntime({ onDuty }: { onDuty: boolean }) {
  const [queue, setQueue] = useState<QueuedEvent[]>([]);
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
  const [wake, setWake] = useState(false);
  const [gps, setGps] = useState<"ok" | "denied" | "off">("off");
  const buffer = useRef<{ lat: number; lng: number; accuracy?: number; speed?: number | null; at: string }[]>([]);
  const wakeLock = useRef<{ release: () => Promise<void> } | null>(null);

  // Service worker: abre la app y las páginas ya visitadas aunque no haya señal.
  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);

  // Cola
  useEffect(() => {
    const refresh = () => listQueue().then(setQueue).catch(() => {});
    refresh();
    const off = onQueueChange(refresh);
    const tick = setInterval(() => void flush(), 20_000);
    const up = () => void flush();
    window.addEventListener("online", up);
    void flush();
    return () => {
      off();
      clearInterval(tick);
      window.removeEventListener("online", up);
    };
  }, []);

  // Ubicación en vivo durante el turno
  useEffect(() => {
    if (!onDuty || !("geolocation" in navigator)) return;
    let last = 0;
    const watch = navigator.geolocation.watchPosition(
      (p) => {
        setGps("ok");
        if (p.timestamp - last < MIN_MOVE_MS) return;
        last = p.timestamp;
        buffer.current.push({
          lat: p.coords.latitude,
          lng: p.coords.longitude,
          accuracy: p.coords.accuracy,
          speed: p.coords.speed,
          at: new Date(p.timestamp).toISOString(),
        });
        if (buffer.current.length > 500) buffer.current.splice(0, buffer.current.length - 500);
      },
      (err) => setGps(err.code === err.PERMISSION_DENIED ? "denied" : "off"),
      { enableHighAccuracy: true, maximumAge: 15_000, timeout: 30_000 },
    );
    const send = async () => {
      if (!buffer.current.length || !navigator.onLine) return;
      const points = buffer.current.splice(0);
      try {
        const res = await fetch("/api/driver/location", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ points }),
        });
        if (!res.ok) buffer.current.unshift(...points);
      } catch {
        buffer.current.unshift(...points);
      }
    };
    const id = setInterval(send, SEND_EVERY_MS);
    return () => {
      navigator.geolocation.clearWatch(watch);
      clearInterval(id);
      void send();
    };
  }, [onDuty]);

  // Pantalla encendida (plan B de ubicación en iPhone): se reactiva al volver a la app.
  useEffect(() => {
    if (!wake) return;
    const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } };
    const acquire = async () => {
      try {
        wakeLock.current = (await nav.wakeLock?.request("screen")) ?? null;
      } catch {
        setWake(false);
      }
    };
    acquire();
    const onVisible = () => document.visibilityState === "visible" && acquire();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      void wakeLock.current?.release();
    };
  }, [wake]);

  const pending = queue.filter((q) => !q.error);
  const failed = queue.filter((q) => q.error);

  return (
    <div className="mb-4 space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className={`rounded-full px-2 py-1 ${online ? "bg-emerald-50 text-emerald-700" : "bg-amber-100 text-amber-800"}`}>
          {online ? "Con señal" : "Sin señal: se guardará y enviará después"}
        </span>
        {onDuty && (
          <span className={`rounded-full px-2 py-1 ${gps === "ok" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
            {gps === "ok" ? "Ubicación activa" : gps === "denied" ? "Permite la ubicación en el navegador" : "Buscando GPS…"}
          </span>
        )}
        {pending.length > 0 && (
          <button type="button" onClick={() => void flush()} className="rounded-full bg-blue-50 px-2 py-1 text-blue-700">
            {pending.length} por enviar · reintentar
          </button>
        )}
        {onDuty && "wakeLock" in (globalThis.navigator ?? {}) && (
          <button type="button" onClick={() => setWake((w) => !w)} className={`rounded-full px-2 py-1 ${wake ? "bg-brand text-white" : "bg-slate-100 text-slate-700"}`}>
            {wake ? "Pantalla siempre encendida" : "Mantener pantalla encendida"}
          </button>
        )}
      </div>
      {failed.map((f) => (
        <div key={f.clientEventId} className="flex items-start justify-between gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          <span>
            {f.orderCode}: {f.error}
          </span>
          <button type="button" className="shrink-0 text-xs underline" onClick={() => dismiss(f.clientEventId).then(() => listQueue().then(setQueue))}>
            Descartar
          </button>
        </div>
      ))}
    </div>
  );
}
