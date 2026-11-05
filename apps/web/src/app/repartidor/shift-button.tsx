"use client";

import { useState, useTransition } from "react";
import { startShift, toggleShift } from "./actions";
import { LocationBlock, NATIVE_BLOCKING, nativeBridge } from "./location-help";

type Block = { title: string; steps?: string[]; app?: boolean };

/**
 * «Iniciar turno» solo arranca con la ubicación funcionando: app Android con permiso «todo el
 * tiempo» y precisa, o en el navegador con permiso y GPS. Así no hay turnos «sin ubicación».
 */
export function ShiftButton({ onDuty }: { onDuty: boolean }) {
  const [block, setBlock] = useState<Block | null>(null);
  const [busy, start] = useTransition();

  if (onDuty) {
    return (
      <form action={toggleShift}>
        <button className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700">Terminar turno</button>
      </form>
    );
  }

  const tryStart = () =>
    start(async () => {
      setBlock(null);
      const native = nativeBridge();
      if (native) {
        let st = "ok";
        try {
          st = native.locationStatus?.() ?? (native.hasLocation() ? "ok" : "denied");
        } catch {
          st = "denied";
        }
        if (NATIVE_BLOCKING[st]) return setBlock(NATIVE_BLOCKING[st]);
        await startShift(null);
        return;
      }
      // Android sin la app: la ubicación se corta al bloquear el teléfono; hay que instalarla.
      if (/Android/i.test(navigator.userAgent)) {
        return setBlock({ title: "Instala la app Packatelas para trabajar", app: true, steps: ["Toca «Descargar la app».", "Ábrela e instálala (si pide permiso, permite «instalar apps de esta fuente»).", "Entra con tu usuario y acepta la ubicación «todo el tiempo».", "Inicia tu turno desde la app."] });
      }
      if (!("geolocation" in navigator)) return setBlock({ title: "Este navegador no comparte ubicación" });
      const pos = await new Promise<GeolocationPosition | GeolocationPositionError>((resolve) =>
        navigator.geolocation.getCurrentPosition(resolve, resolve, { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 }),
      );
      if ("code" in pos) {
        return setBlock({ title: pos.code === pos.PERMISSION_DENIED ? "Permite tu ubicación para iniciar turno" : "No encontramos tu ubicación: enciende el GPS" });
      }
      await startShift({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy });
    });

  return (
    <>
      <button type="button" onClick={tryStart} disabled={busy} className="rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60">
        {busy ? "Revisando ubicación…" : "Iniciar turno"}
      </button>
      {block && (
        <LocationBlock
          title={block.title}
          steps={block.steps}
          native={nativeBridge()}
          onRetry={block.app ? () => setBlock(null) : tryStart}
          retryLabel={block.app ? "Cerrar" : "Ya lo activé, iniciar turno"}
          extra={block.app ? <a href="/app/packatelas.apk" className="block rounded-xl bg-accent py-4 text-center text-lg font-bold text-brand">Descargar la app</a> : undefined}
        />
      )}
    </>
  );
}
