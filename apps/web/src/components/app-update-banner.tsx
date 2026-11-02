"use client";

import { useSyncExternalStore } from "react";
import { APK_PATH, APP_RELEASE, appVersionFromUa, olderThanLatest } from "@/lib/app-release";

const noop = () => () => {};

/** Dentro de la app Android vieja: aviso fijo para instalar la versión nueva. */
export function AppUpdateBanner() {
  const version = useSyncExternalStore(noop, () => appVersionFromUa(navigator.userAgent), () => null);
  if (!olderThanLatest(version)) return null;
  return (
    <a href={APK_PATH} className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-brand/30 bg-brand/5 px-3 py-2 text-sm text-brand">
      <span>
        <strong>Hay una versión nueva de la app ({APP_RELEASE.versionName}).</strong> Tienes la {version}. Toca para descargarla y luego ábrela desde la notificación para instalar.
      </span>
      <span className="shrink-0 rounded-lg bg-brand px-3 py-1.5 font-semibold text-white">Actualizar</span>
    </a>
  );
}
