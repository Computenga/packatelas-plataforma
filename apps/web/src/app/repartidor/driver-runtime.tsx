"use client";

// Procesos de fondo de la app del repartidor mientras la página está abierta:
// cola sin conexión, ubicación en vivo, pantalla encendida y service worker [R10, R11, P04].
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { dismiss, flush, listQueue, onQueueChange, type QueuedEvent } from "@/lib/offline-queue";
import { LocationBlock, NATIVE_BLOCKING, type NativeBridge } from "./location-help";
import { toggleShift } from "./actions";

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
const noopSubscribe = () => () => {};


export function DriverRuntime({ onDuty }: { onDuty: boolean }) {
  const [queue, setQueue] = useState<QueuedEvent[]>([]);
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
  const [wake, setWake] = useState(false);
  // Solo en el navegador (en el servidor no hay navigator): evita el desajuste al hidratar.
  const canWake = useSyncExternalStore(noopSubscribe, () => "wakeLock" in navigator, () => false);
  const [gps, setGps] = useState<"ok" | "denied" | "off">("off");
  const [nativeLoc, setNativeLoc] = useState<string>("ok");
  const [awayMin, setAwayMin] = useState(0);
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

  // App Android: el GPS lo lleva la app nativa en segundo plano, aun con la pantalla apagada [P03].
  const native = typeof window !== "undefined" ? (window as Window & { PackatelasNative?: NativeBridge }).PackatelasNative : undefined;
  useEffect(() => {
    if (!native) return;
    native.setOnDuty(onDuty);
    if (!onDuty) return;
    // El permiso se concede en un diálogo de Android después de esta llamada: hay que volver a
    // preguntar (antes se quedaba en "sin ubicación" aunque ya estuviera permitido).
    const check = () => {
      try {
        // App 1.3+: estado detallado (GPS apagado, solo aproximada, solo "mientras se usa").
        const st = native.locationStatus?.() ?? (native.hasLocation() ? "ok" : "denied");
        setNativeLoc(st);
        setGps(st === "denied" ? "denied" : st === "gps_off" ? "off" : "ok");
      } catch {
        setGps("off");
      }
    };
    const first = setTimeout(check, 0);
    // Cada 15 s y solo con la app a la vista (al volver se revisa al instante): menos batería.
    const id = setInterval(() => document.visibilityState === "visible" && check(), 15_000);
    const onVisible = () => document.visibilityState === "visible" && check();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(first);
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [onDuty, native]);

  // Ubicación en vivo durante el turno
  useEffect(() => {
    if (native || !onDuty || !("geolocation" in navigator)) return;
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
  }, [onDuty, native]);

  // Si la app estuvo en segundo plano durante el turno, no se mandó ubicación: avisarle [P04].
  useEffect(() => {
    if (!onDuty || native) return;
    let hiddenAt = 0;
    const onChange = () => {
      if (document.visibilityState === "hidden") hiddenAt = Date.now();
      else if (hiddenAt) {
        const min = Math.floor((Date.now() - hiddenAt) / 60_000);
        if (min >= 5) setAwayMin(min);
        hiddenAt = 0;
      }
    };
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, [onDuty, native]);

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

  const isAndroidBrowser = useSyncExternalStore(
    noopSubscribe,
    () => /Android/i.test(navigator.userAgent) && !(window as Window & { PackatelasNative?: unknown }).PackatelasNative,
    () => false,
  );
  const pending = queue.filter((q) => !q.error);
  // Desde la pantalla de bloqueo se puede terminar el turno (p. ej. ya acabó y apagó el GPS).
  const endShift = (
    <form action={toggleShift} className="text-center">
      <button className="text-sm text-slate-300 underline">Ya terminé: cerrar mi turno</button>
    </form>
  );
  const failed = queue.filter((q) => q.error);

  return (
    <div className="mb-4 space-y-2">
      {isAndroidBrowser && onDuty && (
        <a href="/app/packatelas.apk" className="block rounded-lg bg-brand/10 px-3 py-2 text-xs text-brand">
          Instala la app Packatelas para Android: manda tu ubicación aunque apagues la pantalla y te avisa cuando te asignan ruta. <b>Descargar</b>
        </a>
      )}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className={`rounded-full px-2 py-1 ${online ? "bg-emerald-50 text-emerald-700" : "bg-amber-100 text-amber-800"}`}>
          {online ? "Con señal" : "Sin señal: se guardará y enviará después"}
        </span>
        {onDuty && (
          <span className={`rounded-full px-2 py-1 ${gps === "ok" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
            {gps === "ok" ? "Ubicación activa" : gps === "denied" ? (native ? "Permite la ubicación a la app" : "Permite la ubicación en el navegador") : "Buscando GPS…"}
          </span>
        )}
        {pending.length > 0 && (
          <button type="button" onClick={() => void flush()} className="rounded-full bg-blue-50 px-2 py-1 text-blue-700">
            {pending.length} por enviar · reintentar
          </button>
        )}
        {onDuty && canWake && (
          <button type="button" onClick={() => setWake((w) => !w)} className={`rounded-full px-2 py-1 ${wake ? "bg-brand text-white" : "bg-slate-100 text-slate-700"}`}>
            {wake ? "Pantalla siempre encendida" : "Mantener pantalla encendida"}
          </button>
        )}
      </div>
      {/* Sin ubicación no se trabaja: pantalla que bloquea hasta que se arregle. */}
      {onDuty && native && NATIVE_BLOCKING[nativeLoc] && (
        <LocationBlock
          {...NATIVE_BLOCKING[nativeLoc]}
          native={native}
          extra={endShift}
          onRetry={() => {
            try {
              const st = native.locationStatus?.() ?? (native.hasLocation() ? "ok" : "denied");
              setNativeLoc(st);
              setGps(st === "denied" ? "denied" : st === "gps_off" ? "off" : "ok");
            } catch {
              /* se vuelve a revisar solo */
            }
          }}
        />
      )}
      {onDuty && !native && gps === "denied" && (
        <LocationBlock title="Permite tu ubicación para seguir trabajando" onRetry={() => window.location.reload()} extra={endShift} />
      )}
      {awayMin > 0 && (
        <div className="flex items-start justify-between gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <span>Estuviste {awayMin} min fuera de la app y no se envió tu ubicación. Déjala abierta durante el turno (puedes activar &quot;Mantener pantalla encendida&quot;).</span>
          <button type="button" className="shrink-0 text-xs underline" onClick={() => setAwayMin(0)}>Entendido</button>
        </div>
      )}
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
