"use client";

// Captura de dirección con sugerencias y pin en el mapa [A03].
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { withTypedNumber, type GeoResult } from "@/lib/geocode";

const MapPicker = dynamic(() => import("./map-picker").then((m) => m.MapPicker), {
  ssr: false,
  loading: () => <div className="h-64 w-full animate-pulse rounded-lg bg-slate-100" />,
});

type Fields = { addressLine: string; neighborhood: string; city: string; state: string; zip: string };

const input =
  "mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20";

/**
 * variant "order": calle, colonia, alcaldía, estado, CP y coordenadas (formulario de pedido).
 * variant "branch": una sola línea de dirección en el campo `address` y coordenadas.
 */
export function AddressPicker({ variant = "order", defaults }: { variant?: "order" | "branch"; defaults?: Partial<Fields> & { lat?: number; lng?: number } }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<GeoResult[]>([]);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState<string>();
  const [f, setF] = useState<Fields>({
    addressLine: defaults?.addressLine ?? "",
    neighborhood: defaults?.neighborhood ?? "",
    city: defaults?.city ?? "",
    state: defaults?.state ?? "CDMX",
    zip: defaults?.zip ?? "",
  });
  const [pos, setPos] = useState<{ lat?: number; lng?: number }>({ lat: defaults?.lat, lng: defaults?.lng });
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    clearTimeout(timer.current);
    if (q.trim().length < 4) return;
    timer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`);
        const data = (await res.json()) as { results: GeoResult[]; error?: string };
        setResults(data.results);
        setNote(data.error ?? (data.results.length === 0 ? "Sin coincidencias. Captura la dirección y ubica el pin en el mapa." : undefined));
        setOpen(true);
      } catch {
        setNote("Sin conexión con el buscador. Captura la dirección a mano.");
      }
    }, 450);
  }, [q]);

  const pick = (r: GeoResult) => {
    const street = withTypedNumber(r.addressLine, q);
    setF({
      addressLine: variant === "branch" ? r.label.replace(r.addressLine, street) : street,
      neighborhood: r.neighborhood ?? "",
      city: r.city ?? "",
      state: r.state ?? f.state,
      zip: r.zip ?? "",
    });
    setPos({ lat: r.lat, lng: r.lng });
    setOpen(false);
    setQ("");
    setNote("Revisa que el pin esté sobre el lugar exacto; puedes arrastrarlo.");
  };

  const set = (k: keyof Fields) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  return (
    <div className="space-y-3">
      <div className="relative">
        <label className="block">
          <span className="text-sm font-medium text-slate-700">Buscar dirección</span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onFocus={() => results.length && setOpen(true)}
            placeholder="Calle y número, colonia, CP o lugar"
            className={input}
            autoComplete="off"
          />
        </label>
        {open && results.length > 0 && (
          <ul className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-slate-200 bg-white shadow-lg">
            {results.map((r) => (
              <li key={`${r.lat},${r.lng},${r.label}`}>
                <button type="button" onClick={() => pick(r)} className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50">
                  {r.label}
                </button>
              </li>
            ))}
          </ul>
        )}
        {note && <p className="mt-1 text-xs text-slate-500">{note}</p>}
      </div>

      {variant === "branch" ? (
        <label className="block">
          <span className="text-sm font-medium text-slate-700">Dirección</span>
          <input name="address" required value={f.addressLine} onChange={set("addressLine")} className={input} />
        </label>
      ) : (
        <>
          <label className="block">
            <span className="text-sm font-medium text-slate-700">Calle y número</span>
            <input name="addressLine" required value={f.addressLine} onChange={set("addressLine")} className={input} />
          </label>
          <div className="grid gap-3 sm:grid-cols-4">
            <label className="block sm:col-span-2">
              <span className="text-sm font-medium text-slate-700">Colonia</span>
              <input name="neighborhood" value={f.neighborhood} onChange={set("neighborhood")} className={input} />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Alcaldía / municipio</span>
              <input name="city" value={f.city} onChange={set("city")} className={input} />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">C.P.</span>
              <input name="zip" value={f.zip} onChange={set("zip")} inputMode="numeric" maxLength={5} className={input} />
            </label>
          </div>
          <label className="block sm:w-1/3">
            <span className="text-sm font-medium text-slate-700">Estado</span>
            <input name="state" value={f.state} onChange={set("state")} className={input} />
          </label>
        </>
      )}

      <MapPicker lat={pos.lat} lng={pos.lng} onChange={(lat, lng) => setPos({ lat, lng })} />
      <p className="text-xs text-slate-500">
        {pos.lat != null ? `Pin: ${pos.lat.toFixed(6)}, ${pos.lng!.toFixed(6)}` : "Toca el mapa para colocar el pin."}
      </p>
      <input type="hidden" name="lat" value={pos.lat ?? ""} />
      <input type="hidden" name="lng" value={pos.lng ?? ""} />
    </div>
  );
}
