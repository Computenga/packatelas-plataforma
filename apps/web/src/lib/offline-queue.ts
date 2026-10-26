"use client";

// Cola de acciones del repartidor que sobrevive sin señal y a recargas de la página [R11].
// Cada acción lleva un clientEventId único: reintentarla nunca la aplica dos veces.

export type QueuedEvent = {
  clientEventId: string;
  orderId: string;
  orderCode: string;
  type: "loaded" | "delivered" | "failed";
  occurredAt: string;
  lat?: number;
  lng?: number;
  receiverName?: string;
  reason?: string;
  note?: string;
  photo?: Blob;
  photoKey?: string;
  error?: string; // rechazo definitivo del servidor
};

const DB = "packatelas-repartidor";
const STORE = "queue";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "clientEventId" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(req.result);
    t.onerror = () => reject(t.error);
  });
}

export const listQueue = () => tx<QueuedEvent[]>("readonly", (s) => s.getAll() as IDBRequest<QueuedEvent[]>);
const put = (e: QueuedEvent) => tx("readwrite", (s) => s.put(e));
const remove = (id: string) => tx("readwrite", (s) => s.delete(id));
export const dismiss = remove;

const listeners = new Set<() => void>();
export function onQueueChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
const notify = () => listeners.forEach((f) => f());

export async function enqueue(e: Omit<QueuedEvent, "clientEventId" | "occurredAt"> & { occurredAt?: string }) {
  const item: QueuedEvent = { ...e, clientEventId: crypto.randomUUID(), occurredAt: e.occurredAt ?? new Date().toISOString() };
  await put(item);
  notify();
  void flush();
  return item;
}

let flushing: Promise<void> | null = null;

/** Envía lo pendiente. Las fotos se suben primero; luego los eventos en lote. */
export function flush(): Promise<void> {
  if (flushing) return flushing;
  const run = (async () => {
    // Ceder primero: si la función terminara sin ningún await, el `finally` correría antes de
    // guardar `flushing` y el candado quedaría puesto para siempre.
    await Promise.resolve();
    try {
      if (typeof navigator !== "undefined" && !navigator.onLine) return;
      const items = (await listQueue()).filter((i) => !i.error);
      if (!items.length) return;

      for (const item of items) {
        if (item.photo && !item.photoKey) {
          const fd = new FormData();
          fd.append("photo", item.photo, "evidencia.jpg");
          const res = await fetch("/api/driver/photo", { method: "POST", body: fd });
          if (!res.ok) {
            if (res.status === 413 || res.status === 415) {
              item.error = "La foto no se pudo subir; tómala de nuevo.";
              await put(item);
            }
            continue;
          }
          item.photoKey = ((await res.json()) as { key: string }).key;
          await put(item);
        }
      }

      const ready = (await listQueue()).filter((i) => !i.error && (!i.photo || i.photoKey));
      if (!ready.length) return;
      const res = await fetch("/api/driver/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          events: ready.map((i) => ({
            clientEventId: i.clientEventId,
            orderId: i.orderId,
            type: i.type,
            occurredAt: i.occurredAt,
            lat: i.lat,
            lng: i.lng,
            receiverName: i.receiverName,
            reason: i.reason,
            note: i.note,
            photoKey: i.photoKey,
          })),
        }),
      });
      if (!res.ok) return; // sin sesión o servidor caído: se reintenta después
      const { results } = (await res.json()) as {
        results: { clientEventId: string; ok: boolean; error?: string; permanent?: boolean }[];
      };
      for (const r of results) {
        const item = ready.find((i) => i.clientEventId === r.clientEventId);
        if (!item) continue;
        if (r.ok) await remove(item.clientEventId);
        else if (r.permanent) await put({ ...item, error: r.error ?? "Rechazado" });
      }
    } catch {
      // red intermitente: se reintenta en el siguiente ciclo
    } finally {
      notify();
    }
  })();
  flushing = run;
  void run.finally(() => {
    if (flushing === run) flushing = null;
  });
  return run;
}

/** Reduce la foto antes de guardarla/subirla (lado mayor 1280 px, JPEG). */
export async function compressPhoto(file: File): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve) => canvas.toBlob((b) => resolve(b ?? file), "image/jpeg", 0.72));
  } catch {
    return file;
  }
}

/** Posición actual con tope de espera; null si no hay permiso o tarda demasiado. */
export function currentPosition(timeoutMs = 6000): Promise<GeolocationPosition | null> {
  return new Promise((resolve) => {
    if (!("geolocation" in navigator)) return resolve(null);
    navigator.geolocation.getCurrentPosition(resolve, () => resolve(null), {
      enableHighAccuracy: true,
      timeout: timeoutMs,
      maximumAge: 30_000,
    });
  });
}
