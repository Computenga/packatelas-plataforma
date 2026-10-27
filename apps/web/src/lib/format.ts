import type { OrderStatus, PickupStatus } from "@packatelas/db";

const TZ = "America/Mexico_City";

// Los formateadores se crean una sola vez: construirlos es caro y se usan por renglón.
const MXN = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" });
const FECHA = new Intl.DateTimeFormat("es-MX", { timeZone: TZ, dateStyle: "medium", timeStyle: "short" });
const SOLO_FECHA = new Intl.DateTimeFormat("es-MX", { timeZone: TZ, dateStyle: "medium" });

export const mxn = (n: number | string | { toString(): string }) => MXN.format(Number(n.toString()));

export const fecha = (d: Date | null | undefined) => (d ? FECHA.format(d) : "—");

export const soloFecha = (d: Date | null | undefined) => (d ? SOLO_FECHA.format(d) : "—");

/** Inicio del día de hoy en la Ciudad de México. */
export function startOfTodayMx(): Date {
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
  return new Date(`${ymd}T00:00:00-06:00`);
}

export const STATUS_LABEL: Record<OrderStatus, string> = {
  CREATED: "Registrado",
  ASSIGNED: "Asignado",
  OUT_FOR_DELIVERY: "En reparto",
  DELIVERED: "Entregado",
  FAILED: "Fallido",
  RESCHEDULED: "Reprogramado",
  RETURNING: "Regresando",
  RETURNED_TO_WAREHOUSE: "En almacén",
  RETURNED_TO_SELLER: "Devuelto al vendedor",
  CANCELLED: "Cancelado",
};

export const STATUS_TONE: Record<OrderStatus, "gray" | "blue" | "green" | "amber" | "red"> = {
  CREATED: "gray",
  ASSIGNED: "blue",
  OUT_FOR_DELIVERY: "blue",
  DELIVERED: "green",
  FAILED: "red",
  RESCHEDULED: "amber",
  RETURNING: "amber",
  RETURNED_TO_WAREHOUSE: "amber",
  RETURNED_TO_SELLER: "gray",
  CANCELLED: "gray",
};

/** Texto opcional de un formulario: vacío → undefined. */
export const opt = (v: FormDataEntryValue | null) => {
  const s = typeof v === "string" ? v.trim() : "";
  return s === "" ? undefined : s;
};

export const PICKUP_LABEL: Record<PickupStatus, [string, "gray" | "blue" | "green" | "amber" | "red"]> = {
  SCHEDULED: ["Programada", "gray"],
  ASSIGNED: ["Asignada", "blue"],
  COLLECTED: ["Recolectada", "green"],
  FAILED: ["Fallida", "amber"],
  CANCELLED: ["Cancelada", "gray"],
  BLOCKED: ["Bloqueada por adeudo", "red"],
};


/** "35 min", "5 h", "2 d 3 h" desde `d` hasta ahora. */
export function hace(d: Date, now = Date.now()): string {
  const min = Math.max(0, Math.floor((now - d.getTime()) / 60_000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h`;
  const days = Math.floor(h / 24);
  return h % 24 ? `${days} d ${h % 24} h` : `${days} d`;
}
