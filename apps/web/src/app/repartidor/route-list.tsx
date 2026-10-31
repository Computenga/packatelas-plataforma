"use client";

// Ruta del repartidor ordenada desde su ubicación [R02], con acciones de entrega dentro
// de cada parada para que funcione sin señal [R04, R06, R07, R08, R11].
import { useCallback, useEffect, useState } from "react";
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
  lat: number | null;
  lng: number | null;
  /** Minutos estimados de manejo hasta aquí (con tráfico, si hay TomTom). */
  etaMin?: number | null;
};

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

  // Todas las actualizaciones de estado ocurren después del primer await.
  const fetchRoute = useCallback(async () => {
    const pos = await currentPosition(5000);
    const qs = pos ? `?lat=${pos.coords.latitude}&lng=${pos.coords.longitude}` : "";
    try {
      const res = await fetch(`/api/driver/route${qs}`, { cache: "no-store" });
      if (!res.ok) throw new Error();
      const data = (await res.json()) as { orders: Stop[]; method: string };
      setStops(data.orders);
      localStorage.setItem(CACHE_KEY, JSON.stringify({ stops: data.orders, at: new Date().toISOString() }));
      setStatus(
        data.method === "sin-ubicacion"
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

  const reload = () => {
    setLoading(true);
    void fetchRoute();
  };

  const visible = stops.filter((s) => !doneIds.has(s.id));

  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-semibold">Mi ruta ({visible.length})</h2>
        <button type="button" onClick={reload} disabled={loading} className="text-sm text-brand disabled:opacity-50">
          {loading ? "Ordenando…" : "Reordenar desde aquí"}
        </button>
      </div>
      <p className="mb-3 text-xs text-slate-500">{status}</p>

      <ol className="space-y-2">
        {visible.map((s, i) => (
          <li key={s.id} className="rounded-xl border border-slate-200 bg-white">
            <button type="button" onClick={() => setOpen(open === s.id ? null : s.id)} className="flex w-full gap-3 p-3 text-left">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand text-sm font-bold text-white">{i + 1}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{s.recipient ?? "Sin nombre"}</span>
                <span className="block text-sm text-slate-600">{s.address}</span>
                <span className="block text-xs text-slate-500">
                  <span className="font-mono">{s.code}</span> · {s.client}
                  {s.etaMin != null && <span className="ml-1 text-slate-600">· ~{s.etaMin} min</span>}
                  {s.status === "ASSIGNED" && !loadedIds.has(s.id) && <span className="ml-1 text-amber-700">· falta escanear al cargar</span>}
                </span>
              </span>
            </button>
            {open === s.id && <StopActions stop={s} onDone={() => setOpen(null)} />}
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

function StopActions({ stop, onDone }: { stop: Stop; onDone: () => void }) {
  const [mode, setMode] = useState<"none" | "deliver" | "fail">("none");
  const [photo, setPhoto] = useState<File | null>(null);
  const [receiver, setReceiver] = useState(stop.recipient ?? "");
  const [reason, setReason] = useState("nadie");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string>();

  const dest = stop.lat != null ? `${stop.lat},${stop.lng}` : encodeURIComponent(stop.address);
  const phone = stop.phone?.replace(/[^\d+]/g, "");
  const wa = phone ? `https://wa.me/${phone.startsWith("+") ? phone.slice(1) : phone.length === 10 ? `52${phone}` : phone}` : null;

  const submit = async () => {
    setErr(undefined);
    if (mode === "deliver" && !photo) return setErr("Toma la foto de la entrega.");
    setSaving(true);
    try {
      const pos = await currentPosition(4000);
      await enqueue({
        orderId: stop.id,
        orderCode: stop.code,
        type: mode === "deliver" ? "delivered" : "failed",
        lat: pos?.coords.latitude,
        lng: pos?.coords.longitude,
        receiverName: mode === "deliver" ? receiver.trim() || undefined : undefined,
        reason: mode === "fail" ? reason : undefined,
        note: note.trim() || undefined,
        photo: photo ? await compressPhoto(photo) : undefined,
      });
      onDone();
    } catch {
      setErr("No se pudo guardar. Inténtalo de nuevo.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3 border-t border-slate-100 p-3">
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

      {mode === "none" && (
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => setMode("deliver")} className="rounded-lg bg-emerald-600 py-3 font-semibold text-white">
            Entregado
          </button>
          <button type="button" onClick={() => setMode("fail")} className="rounded-lg bg-red-600 py-3 font-semibold text-white">
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
          <label className="block text-sm">
            <span className="font-medium">{mode === "deliver" ? "Foto de la entrega (obligatoria)" : "Foto (opcional)"}</span>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
              className="mt-1 block w-full text-sm"
            />
          </label>
          <label className="block text-sm">
            <span className="font-medium">Nota</span>
            <input value={note} onChange={(e) => setNote(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
          </label>
          {err && <p role="alert" className="text-sm text-red-600">{err}</p>}
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setMode("none")} className="rounded-lg border border-slate-300 py-2.5">
              Cancelar
            </button>
            <button
              type="button"
              disabled={saving}
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
