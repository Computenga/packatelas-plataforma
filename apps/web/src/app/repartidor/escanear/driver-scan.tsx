"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { Scanner } from "@/components/scanner";
import { currentPosition, enqueue } from "@/lib/offline-queue";
import { driverScan } from "../actions";
import type { Stop } from "../route-list";

type Line = { id: number; tone: "ok" | "warn" | "err"; text: string; externalRef?: string };

/** Sin señal: busca la etiqueta en la ruta guardada para registrar la carga de todos modos. */
function matchCachedRoute(raw: string): Stop | null {
  try {
    const cached = JSON.parse(localStorage.getItem("pk-route") ?? "null") as { stops: Stop[] } | null;
    if (!cached) return null;
    let code = raw.trim().toUpperCase();
    if (code.startsWith("{")) code = `ML-${String((JSON.parse(raw) as { id?: string }).id ?? "")}`;
    else if (/^\d{10,13}$/.test(code)) code = `ML-${code}`;
    return cached.stops.find((s) => s.code.toUpperCase() === code) ?? null;
  } catch {
    return null;
  }
}

export function DriverScan() {
  const [lines, setLines] = useState<Line[]>([]);
  const [busy, setBusy] = useState(false);
  const add = (l: Omit<Line, "id">) => setLines((p) => [{ ...l, id: Date.now() + Math.random() }, ...p].slice(0, 50));

  const loadOrder = async (orderId: string, code: string) => {
    const pos = await currentPosition(3000);
    await enqueue({ orderId, orderCode: code, type: "loaded", lat: pos?.coords.latitude, lng: pos?.coords.longitude });
  };

  const onScan = useCallback(async (raw: string) => {
    setBusy(true);
    try {
      if (!navigator.onLine) {
        const stop = matchCachedRoute(raw);
        if (stop) {
          await loadOrder(stop.id, stop.code);
          add({ tone: "ok", text: `${stop.code} cargado (se enviará al recuperar señal)` });
        } else add({ tone: "err", text: "Sin señal y el paquete no está en tu ruta guardada. Escanéalo cuando tengas señal." });
        return;
      }
      const r = await driverScan(raw);
      if (r.status === "found") {
        if (!r.mine && !r.free) add({ tone: "err", text: `${r.code} está asignado a otro repartidor. Avisa al despachador.` });
        else if (!["CREATED", "ASSIGNED", "RESCHEDULED", "FAILED", "OUT_FOR_DELIVERY"].includes(r.orderStatus)) add({ tone: "warn", text: `${r.code} ya no está pendiente de entrega.` });
        else {
          await loadOrder(r.orderId, r.code);
          add({ tone: "ok", text: `${r.code} cargado${r.free ? " y agregado a tu ruta" : ""}` });
        }
      } else if (r.status === "external") add({ tone: "warn", text: "Paquete no registrado.", externalRef: r.raw });
      else add({ tone: "err", text: r.message });
      navigator.vibrate?.(60);
    } catch {
      add({ tone: "err", text: "No se pudo procesar; vuelve a escanear." });
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <div className="space-y-4">
      <Scanner onScan={onScan} busy={busy} />
      <ul className="space-y-2">
        {lines.map((l) => (
          <li
            key={l.id}
            className={`rounded-lg px-3 py-2 text-sm ${l.tone === "ok" ? "bg-emerald-50 text-emerald-800" : l.tone === "warn" ? "bg-amber-50 text-amber-900" : "bg-red-50 text-red-700"}`}
          >
            {l.text}{" "}
            {l.externalRef !== undefined && (
              <Link href={`/repartidor/externo?ref=${encodeURIComponent(l.externalRef)}`} className="font-semibold underline">
                Darlo de alta
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
