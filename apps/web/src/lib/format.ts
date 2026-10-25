import type { OrderStatus } from "@packatelas/db";

const TZ = "America/Mexico_City";

export const mxn = (n: number | string | { toString(): string }) =>
  new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(Number(n.toString()));

export const fecha = (d: Date | null | undefined) =>
  d ? new Intl.DateTimeFormat("es-MX", { timeZone: TZ, dateStyle: "medium", timeStyle: "short" }).format(d) : "—";

export const soloFecha = (d: Date | null | undefined) =>
  d ? new Intl.DateTimeFormat("es-MX", { timeZone: TZ, dateStyle: "medium" }).format(d) : "—";

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
