"use client";

// Ruta del repartidor ordenada desde su ubicación [R02], con acciones de entrega dentro
// de cada parada para que funcione sin señal [R04, R06, R07, R08, R11].
import { useCallback, useEffect, useRef, useState } from "react";
import { compressPhoto, currentPosition, enqueue, listQueue, onQueueChange } from "@/lib/offline-queue";

export type Stop = {
  id: string;
  code: string;
  status: string;
  client: string;
  recipient: string | null;
  phone: string | null;
  address: string;
  zip: string | null;
  instructions: string | null;
  /** Orden de devolución (DV-): qué paquetes se le entregan a la tienda. */
  kind?: string;
  items?: string | null;
  lat: number | null;
  lng: number | null;
  /** Minutos estimados de manejo hasta aquí (con tráfico, si hay TomTom). */
  etaMin?: number | null;
  /** Mercado Libre ya lo marcó entregado y aquí falta la evidencia. */
  mlDelivered?: boolean;
};

/** Distancia en metros entre dos puntos. */
function meters(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const r = Math.PI / 180;
  const x = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lng - a.lng) * r) / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(x));
}
/** A esta distancia (o menos) se asume que estás entregando ese pedido. */
const HERE_M = 250;
const STAMP_FMT = new Intl.DateTimeFormat("es-MX", {
  timeZone: "America/Mexico_City", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
});

const CACHE_KEY = "pk-route";
const REASONS: [string, string][] = [
  ["nadie", "No había nadie"],
  ["direccion", "Dirección incorrecta o incompleta"],
  ["rechazo", "El cliente rechazó el paquete"],
  ["acceso", "Sin acceso al domicilio"],
  ["reprogramo", "El cliente pidió otra fecha"],
  ["zona", "Zona insegura o fuera de cobertura"],
  ["otro", "Otro motivo"],
];

function readCache(): { stops: Stop[]; at: string } | null {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null");
  } catch {
    return null;
  }
}

export function RouteList() {
  const [stops, setStops] = useState<Stop[]>([]);
  const [doneIds, setDoneIds] = useState<Set<string>>(new Set());
  const [loadedIds, setLoadedIds] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("Cargando ruta…");
  const [loading, setLoading] = useState(true);
  const [here, setHere] = useState<{ lat: number; lng: number } | null>(null);

  // Todas las actualizaciones de estado ocurren después del primer await.
  const fetchRoute = useCallback(async () => {
    const pos = await currentPosition(5000);
    if (pos) setHere({ lat: pos.coords.latitude, lng: pos.coords.longitude });
    const qs = pos ? `?lat=${pos.coords.latitude}&lng=${pos.coords.longitude}` : "";
    try {
      const res = await fetch(`/api/driver/route${qs}`, { cache: "no-store" });
      if (!res.ok) throw new Error();
      const data = (await res.json()) as { orders: Stop[]; method: string };
      setStops(data.orders);
      localStorage.setItem(CACHE_KEY, JSON.stringify({ stops: data.orders, at: new Date().toISOString() }));
      setStatus(
        data.orders.length === 0
          ? ""
          : data.method === "sin-ubicacion"
          ? "Sin tu ubicación: orden de asignación. Activa el GPS para ordenar la ruta."
          : `Ordenada desde tu ubicación ${data.method === "tomtom" ? "(con tráfico en vivo)" : data.method === "osrm" ? "(tiempos reales)" : ""}`,
      );
    } catch {
      const cached = readCache();
      if (cached) {
        setStops(cached.stops);
        setStatus(`Sin señal: ruta guardada de las ${new Date(cached.at).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })}`);
      } else setStatus("No se pudo cargar la ruta. Revisa tu señal.");
    } finally {
      setLoading(false);
    }
  }, []);

  // Pedidos ya cerrados localmente (aunque sigan en la cola) se ocultan.
  useEffect(() => {
    const sync = () =>
      listQueue()
        .then((q) => {
          setDoneIds(new Set(q.filter((e) => e.type !== "loaded" && !e.error).map((e) => e.orderId)));
          setLoadedIds(new Set(q.filter((e) => e.type === "loaded" && !e.error).map((e) => e.orderId)));
        })
        .catch(() => {});
    sync();
    return onQueueChange(sync);
  }, []);

  useEffect(() => {
    const id = setTimeout(() => void fetchRoute(), 0);
    return () => clearTimeout(id);
  }, [fetchRoute]);

  // Revisa cada minuto (y al volver a la app) si ML ya marcó entregado algún pedido.
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") void fetchRoute();
    };
    const id = setInterval(tick, 60_000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [fetchRoute]);

  const reload = () => {
    setLoading(true);
    void fetchRoute();
  };

  const pending = stops.filter((s) => !doneIds.has(s.id));
  // Arriba: lo que ML ya marcó entregado (falta la foto); si no hay, el pedido donde estás parado.
  const mlDone = pending.filter((s) => s.mlDelivered);
  let nearId: string | null = null;
  if (!mlDone.length && here) {
    let best = HERE_M;
    for (const s of pending) {
      if (s.lat == null || s.lng == null) continue;
      const d = meters(here, { lat: s.lat, lng: s.lng });
      if (d <= best) {
        best = d;
        nearId = s.id;
      }
    }
  }
  const visible = [...mlDone, ...pending.filter((s) => !s.mlDelivered && s.id === nearId), ...pending.filter((s) => !s.mlDelivered && s.id !== nearId)];

  // Al cerrar una parada se quita de la lista local (y del respaldo sin señal): cuando la cola
  // termina de enviarla deja de estar en `doneIds`, y sin esto volvía a aparecer pidiendo evidencia.
  const closeStop = (id: string) => {
    setOpen(null);
    setStops((prev) => {
      const next = prev.filter((x) => x.id !== id);
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({ stops: next, at: new Date().toISOString() }));
      } catch {
        /* sin almacenamiento: solo en memoria */
      }
      return next;
    });
  };

  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-semibold">Mi ruta ({visible.length})</h2>
        <button type="button" onClick={reload} disabled={loading} className="text-sm text-brand disabled:opacity-50">
          {loading ? "Ordenando…" : "Reordenar desde aquí"}
        </button>
      </div>
      <p className="mb-3 text-xs text-slate-500">{status}</p>
      {mlDone.length > 0 && (
        <button
          type="button"
          onClick={() => setOpen(mlDone[0].id)}
          className="mb-3 w-full rounded-xl border border-red-300 bg-red-50 p-3 text-left text-sm text-red-800"
        >
          <strong>Mercado Libre ya marcó entregado{mlDone.length > 1 ? ` ${mlDone.length} pedidos` : ` ${mlDone[0].code}`}.</strong> Sube la foto de evidencia
          {mlDone.length > 1 ? "; están hasta arriba." : "; toca aquí para abrirlo."}
        </button>
      )}

      <ol className="space-y-2">
        {visible.map((s, i) => (
          <li key={s.id} className={`rounded-xl border bg-white ${s.mlDelivered ? "border-red-400 ring-1 ring-red-300" : s.id === nearId ? "border-emerald-400" : "border-slate-200"}`}>
            <button type="button" onClick={() => setOpen(open === s.id ? null : s.id)} className="flex w-full gap-3 p-3 text-left">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand text-sm font-bold text-white">{i + 1}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{s.recipient ?? "Sin nombre"}</span>
                <span className="block text-sm text-slate-600">{s.address}</span>
                <span className="block text-xs text-slate-500">
                  {s.mlDelivered && <span className="mr-1 rounded bg-red-100 px-1 font-semibold text-red-800">ENTREGADO EN ML · FALTA FOTO</span>}
                  {s.id === nearId && <span className="mr-1 rounded bg-emerald-100 px-1 font-semibold text-emerald-800">ESTÁS AQUÍ</span>}
                  {s.kind === "RETURN" && <span className="mr-1 rounded bg-amber-100 px-1 font-semibold text-amber-800">DEVOLUCIÓN</span>}
                  <span className="font-mono">{s.code}</span> · {s.client}
                  {s.etaMin != null && <span className="ml-1 text-slate-600">· ~{s.etaMin} min</span>}
                  {s.status === "ASSIGNED" && !loadedIds.has(s.id) && <span className="ml-1 text-amber-700">· falta escanear al cargar</span>}
                </span>
              </span>
            </button>
            {open === s.id && <StopActions stop={s} onDone={() => closeStop(s.id)} />}
          </li>
        ))}
      </ol>
      {visible.length === 0 && !loading && (
        <p className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
          No tienes pedidos pendientes.
        </p>
      )}
    </section>
  );
}

type Shot = { blob: Blob; url: string; takenAt: string; lat?: number; lng?: number; acc?: number };

function StopActions({ stop, onDone }: { stop: Stop; onDone: () => void }) {
  const [mode, setMode] = useState<"none" | "deliver" | "fail">("none");
  const [shot, setShot] = useState<Shot | null>(null);
  const [taking, setTaking] = useState(false);
  const [receiver, setReceiver] = useState(stop.recipient ?? "");
  const [reason, setReason] = useState("nadie");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string>();
  const camRef = useRef<HTMLInputElement>(null);
  // La ubicación se pide al tocar el botón, mientras se toma la foto.
  const posRef = useRef<Promise<GeolocationPosition | null> | null>(null);

  useEffect(() => () => {
    if (shot) URL.revokeObjectURL(shot.url);
  }, [shot]);

  /** Abre la cámara en el mismo toque del botón (los navegadores lo exigen). */
  const openCamera = (m: "deliver" | "fail") => {
    setMode(m);
    setErr(undefined);
    posRef.current = currentPosition(8000);
    if (camRef.current) {
      camRef.current.value = "";
      camRef.current.click();
    }
  };

  const onPhoto = async (file: File | undefined) => {
    if (!file) return;
    setTaking(true);
    const takenAt = new Date();
    const pos = await (posRef.current ?? currentPosition(6000));
    posRef.current = null;
    const lat = pos?.coords.latitude;
    const lng = pos?.coords.longitude;
    const acc = pos?.coords.accuracy;
    const stamp = [
      `${STAMP_FMT.format(takenAt)} (hora CDMX)`,
      lat != null && lng != null ? `${lat.toFixed(6)}, ${lng.toFixed(6)}${acc != null ? ` ±${Math.round(acc)} m` : ""}` : "Sin ubicación GPS",
      `Packatelas · ${stop.code}${mode === "fail" ? " · NO ENTREGADO" : ""}`,
    ];
    const blob = await compressPhoto(file, stamp);
    setShot({ blob, url: URL.createObjectURL(blob), takenAt: takenAt.toISOString(), lat, lng, acc });
    setTaking(false);
  };

  const submit = async () => {
    setErr(undefined);
    if (mode === "deliver" && !shot) return setErr("Toma la foto de la entrega.");
    setSaving(true);
    try {
      // Coordenadas y hora de la foto; sin foto (no entregado), las de este momento.
      const pos = shot?.lat != null ? null : await currentPosition(4000);
      await enqueue({
        orderId: stop.id,
        orderCode: stop.code,
        type: mode === "deliver" ? "delivered" : "failed",
        occurredAt: shot?.takenAt,
        lat: shot?.lat ?? pos?.coords.latitude,
        lng: shot?.lng ?? pos?.coords.longitude,
        receiverName: mode === "deliver" ? receiver.trim() || undefined : undefined,
        reason: mode === "fail" ? reason : undefined,
        note: note.trim() || undefined,
        photo: shot?.blob,
      });
      onDone();
    } catch {
      setErr("No se pudo guardar. Inténtalo de nuevo.");
    } finally {
      setSaving(false);
    }
  };

  const dest = stop.lat != null ? `${stop.lat},${stop.lng}` : encodeURIComponent(stop.address);
  const phone = stop.phone?.replace(/[^\d+]/g, "");
  const wa = phone ? `https://wa.me/${phone.startsWith("+") ? phone.slice(1) : phone.length === 10 ? `52${phone}` : phone}` : null;

  return (
    <div className="space-y-3 border-t border-slate-100 p-3">
      {stop.kind === "RETURN" && stop.items && <p className="rounded-lg bg-slate-100 p-2 text-sm"><strong>Entregar a la tienda:</strong> {stop.items}</p>}
      {stop.instructions && <p className="rounded-lg bg-amber-50 p-2 text-sm text-amber-900">{stop.instructions}</p>}
      <div className="grid grid-cols-3 gap-2 text-center text-sm">
        <a className="rounded-lg border border-slate-300 py-2" href={`https://www.google.com/maps/dir/?api=1&destination=${dest}`} target="_blank" rel="noreferrer">
          Google Maps
        </a>
        <a className="rounded-lg border border-slate-300 py-2" href={stop.lat != null ? `https://waze.com/ul?ll=${dest}&navigate=yes` : `https://waze.com/ul?q=${dest}`} target="_blank" rel="noreferrer">
          Waze
        </a>
        {phone ? (
          <a className="rounded-lg border border-slate-300 py-2" href={`tel:${phone}`}>
            Llamar
          </a>
        ) : (
          <span className="rounded-lg border border-slate-200 py-2 text-slate-400">Sin teléfono</span>
        )}
      </div>
      {wa && (
        <a className="block rounded-lg border border-emerald-300 py-2 text-center text-sm text-emerald-700" href={wa} target="_blank" rel="noreferrer">
          WhatsApp
        </a>
      )}

      <input
        ref={camRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => void onPhoto(e.target.files?.[0])}
      />

      {mode === "none" && (
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => openCamera("deliver")} className="rounded-lg bg-emerald-600 py-3 font-semibold text-white">
            Entregado
          </button>
          <button type="button" onClick={() => openCamera("fail")} className="rounded-lg bg-red-600 py-3 font-semibold text-white">
            No entregado
          </button>
        </div>
      )}

      {mode !== "none" && (
        <div className="space-y-3">
          {mode === "deliver" ? (
            <label className="block text-sm">
              <span className="font-medium">¿Quién recibió?</span>
              <input value={receiver} onChange={(e) => setReceiver(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
            </label>
          ) : (
            <label className="block text-sm">
              <span className="font-medium">Motivo</span>
              <select value={reason} onChange={(e) => setReason(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2">
                {REASONS.map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="text-sm">
            <span className="font-medium">{mode === "deliver" ? "Foto de la entrega (obligatoria)" : "Foto (opcional)"}</span>
            {taking ? (
              <p className="mt-1 rounded-lg bg-slate-100 p-3 text-slate-600">Procesando foto y ubicación…</p>
            ) : shot ? (
              <div className="mt-1">
                {/* eslint-disable-next-line @next/next/no-img-element -- vista previa local (blob:) */}
                <img src={shot.url} alt="Foto de evidencia" className="w-full rounded-lg border border-slate-200" />
                {shot.lat == null && <p className="mt-1 text-xs text-amber-700">Sin ubicación: activa el GPS y repite la foto si puedes.</p>}
              </div>
            ) : null}
            <button
              type="button"
              onClick={() => openCamera(mode)}
              className="mt-2 w-full rounded-lg border border-slate-300 py-2.5 font-medium"
            >
              {shot ? "Repetir foto" : "📷 Tomar foto"}
            </button>
          </div>
          <label className="block text-sm">
            <span className="font-medium">Nota</span>
            <input value={note} onChange={(e) => setNote(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
          </label>
          {err && <p role="alert" className="text-sm text-red-600">{err}</p>}
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => { setMode("none"); setShot(null); }} className="rounded-lg border border-slate-300 py-2.5">
              Cancelar
            </button>
            <button
              type="button"
              disabled={saving || taking}
              onClick={submit}
              className={`rounded-lg py-2.5 font-semibold text-white disabled:opacity-50 ${mode === "deliver" ? "bg-emerald-600" : "bg-red-600"}`}
            >
              {saving ? "Guardando…" : "Confirmar"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
