import type { Metadata } from "next";
import { gateRoster, prisma, todayMx } from "@packatelas/db";
import { RosterView } from "./roster";

export const metadata: Metadata = { title: "Recepción" };
export const dynamic = "force-dynamic";

const DAY = new Intl.DateTimeFormat("es-MX", { timeZone: "America/Mexico_City", weekday: "long", day: "numeric", month: "long" });

export default async function RecepcionPage({ searchParams }: PageProps<"/recepcion">) {
  const mode = (await searchParams).modo === "salida" ? "salida" : "llegada";
  const rows = await gateRoster(prisma, todayMx());
  return (
    <RosterView
      mode={mode}
      day={DAY.format(new Date())}
      rows={rows.map((r) => ({
        ...r,
        endDate: r.endDate?.toISOString() ?? null,
        arrival: r.arrival ? { ...r.arrival, at: r.arrival.at.toISOString() } : null,
        departure: r.departure ? { ...r.departure, at: r.departure.at.toISOString() } : null,
      }))}
    />
  );
}
