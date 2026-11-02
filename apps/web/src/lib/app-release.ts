// Versión vigente de la app Android. La lee también apps/android/app/build.gradle (una sola fuente):
// al sacar versión nueva se sube versionCode/versionName aquí, se compila y se copia el APK a
// public/app/packatelas.apk. Las apps viejas se enteran solas (aviso + ventana para actualizar).
import release from "./app-release.json";

export const APP_RELEASE = release as { versionCode: number; versionName: string; notes: string };
export const APK_PATH = "/app/packatelas.apk";

/** "1.4" → [1, 4]; compara versiones por partes numéricas. */
export function olderThanLatest(versionName: string | null | undefined) {
  if (!versionName) return false;
  const a = versionName.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const b = APP_RELEASE.versionName.split(".").map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) < (b[i] ?? 0);
  }
  return false;
}

/** Versión de la app que hace la petición ("PackatelasAndroid/1.4" en el User-Agent). */
export function appVersionFromUa(ua: string | null | undefined) {
  return ua?.match(/PackatelasAndroid\/([\d.]+)/)?.[1] ?? null;
}
