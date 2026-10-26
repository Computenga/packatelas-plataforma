"use client";

import { useEffect, useState } from "react";

const DISMISS = "pk-push-dismissed";
const toKey = (b64: string) => {
  const s = atob((b64 + "=".repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};

/** Invita a activar las notificaciones push en este dispositivo [P05]. */
export function PushPrompt() {
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string>();

  useEffect(() => {
    const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    let dismissed = false;
    try { dismissed = localStorage.getItem(DISMISS) === "1"; } catch { /* sin almacenamiento */ }
    if (!supported || dismissed) return;
    // Se decide fuera del render inicial (el permiso solo existe en el navegador).
    const t = setTimeout(() => {
      if (Notification.permission === "default") setShow(true);
      else if (Notification.permission === "granted") void subscribe(true); // renueva en silencio
    }, 0);
    return () => clearTimeout(t);
  }, []);

  async function subscribe(silent = false) {
    setBusy(true);
    try {
      if (!silent && (await Notification.requestPermission()) !== "granted") { setMsg("Permiso denegado; puedes activarlo en la configuración del navegador."); return; }
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const { publicKey } = (await (await fetch("/api/push/subscribe")).json()) as { publicKey: string };
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(publicKey) }));
      const res = await fetch("/api/push/subscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(sub.toJSON()) });
      if (!res.ok) throw new Error();
      setShow(false);
    } catch {
      if (!silent) setMsg("No se pudo activar en este dispositivo.");
    } finally {
      setBusy(false);
    }
  }

  if (!show) return null;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
      <span className="flex-1">Activa las notificaciones para enterarte al momento (pedidos asignados, nómina, documentos, fallas).</span>
      <button type="button" disabled={busy} onClick={() => subscribe()} className="rounded-lg bg-brand px-3 py-1.5 font-medium text-white disabled:opacity-50">Activar</button>
      <button type="button" onClick={() => { try { localStorage.setItem(DISMISS, "1"); } catch { /* */ } setShow(false); }} className="text-blue-700">Ahora no</button>
      {msg && <p role="alert" className="w-full text-xs text-red-700">{msg}</p>}
    </div>
  );
}
