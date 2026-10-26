import { hace } from "@/lib/format";

type Lost = { id: string; lastLocationAt: Date | null; user: { name: string } };

/** Repartidores en turno que dejaron de mandar ubicación [P04]. */
export function NoLocationAlert({ drivers, now }: { drivers: Lost[]; now?: number }) {
  if (!drivers.length) return null;
  return (
    <div role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
      <p className="font-semibold">
        {drivers.length === 1 ? "1 repartidor en turno sin ubicación" : `${drivers.length} repartidores en turno sin ubicación`}
      </p>
      <p className="mt-0.5">
        {drivers
          .map((d) => `${d.user.name} (${d.lastLocationAt ? `hace ${hace(d.lastLocationAt, now)}` : "no ha enviado"})`)
          .join(" · ")}
      </p>
      <p className="mt-1 text-xs text-red-700">
        Puede tener la app cerrada, el GPS apagado o sin señal. En iPhone la app debe quedarse abierta durante el turno.
      </p>
    </div>
  );
}
