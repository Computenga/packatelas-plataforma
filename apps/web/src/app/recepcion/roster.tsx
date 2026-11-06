"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { buzz } from "@/lib/beep";
import { identifyAction } from "./actions";
import { SoundGate } from "./sound-gate";

type Row = {
  driverId: string; name: string; employeeNo: number | null; hasPhoto: boolean; active: boolean; endDate: string | null; expected: number;
  arrival: { at: string; ok: boolean; scanned: number; extra: number; missing: number } | null;
  departure: { at: string; ok: boolean; audited: boolean } | null;
};

const HM = new Intl.DateTimeFormat("es-MX", { timeZone: "America/Mexico_City", hour: "2-digit", minute: "2-digit" });
const D = new Intl.DateTimeFormat("es-MX", { timeZone: "America/Mexico_City", day: "numeric", month: "short", year: "numeric" });

export function RosterView({ mode, day, rows }: { mode: "llegada" | "salida"; day: string; rows: Row[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [msg, setMsg] = useState<string>();
  const [pending, start] = useTransition();
  const keyRef = useRef<HTMLInputElement>(null);

  // Se refresca solo cada minuto (la lista cambia con altas, bajas y lo que registran otros).
  useEffect(() => {
    const id = setInterval(() => router.refresh(), 60_000);
    return () => clearInterval(id);
  }, [router]);

  const onKey = useCallback(
    (raw: string) =>
      start(async () => {
        const r = await identifyAction(raw);
        if (!r.ok) {
          buzz();
          setMsg(r.error);
          return;
        }
        const row = rows.find((x) => x.driverId === r.driverId);
        if (row && !row.active) {
          buzz();
          setMsg(`⛔ ${row.name} está dado de baja: SIN ACCESO`);
          return;
        }
        router.push(`/recepcion/${mode}/${r.driverId}?via=${encodeURIComponent(r.via)}`);
      }),
    [mode, router, rows],
  );

  const active = rows.filter((r) => r.active);
  const done = active.filter((r) => (mode === "llegada" ? r.arrival : r.departure));
  const bad = done.filter((r) => !(mode === "llegada" ? r.arrival?.ok : r.departure?.ok));
  const t = q.trim().toLowerCase();
  const shown = rows.filter((r) => !t || r.name.toLowerCase().includes(t) || String(r.employeeNo ?? "").startsWith(t));

  return (
    <div className="space-y-4">
      <SoundGate />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">{day}</p>
          <h1 className="text-2xl font-bold">Control de paquetes de repartidores</h1>
        </div>
        <div className="flex gap-2">
          <Link href="/recepcion?modo=llegada" className={`rounded-full px-5 py-2.5 font-semibold ${mode === "llegada" ? "bg-[#14213d] text-white" : "border border-slate-300 bg-white"}`}>☀️ Llegada</Link>
          <Link href="/recepcion?modo=salida" className={`rounded-full px-5 py-2.5 font-semibold ${mode === "salida" ? "bg-[#14213d] text-white" : "border border-slate-300 bg-white"}`}>🛵 Salida a ruta</Link>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-3">
        {[["Activos", active.length, "border-slate-800"], [mode === "llegada" ? "Registraron llegada" : "Salieron", done.length, "border-emerald-500"], ["No cuadra", bad.length, "border-red-500"], ["Faltan", active.length - done.length, "border-amber-500"]].map(([l, n, c]) => (
          <div key={l as string} className={`rounded-xl border-l-4 bg-white p-3 ${c}`}>
            <p className="text-xs uppercase text-slate-500">{l}</p>
            <p className={`text-3xl font-black ${l === "No cuadra" && Number(n) > 0 ? "text-red-600" : ""}`}>{n}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block rounded-xl border-2 border-dashed border-slate-300 bg-white p-3">
          <span className="text-sm font-semibold">Escanea el llavero de su moto</span>
          <input
            ref={keyRef}
            autoFocus
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            enterKeyHint="go"
            disabled={pending}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              const v = e.currentTarget.value;
              e.currentTarget.value = "";
              setMsg(undefined);
              if (v.trim()) onKey(v);
            }}
            placeholder={pending ? "Buscando…" : "Esperando lectura…"}
            className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-3 text-center font-mono text-lg"
          />
        </label>
        <label className="block rounded-xl border border-slate-200 bg-white p-3">
          <span className="text-sm font-semibold">…o búscalo</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nombre o número de empleado" className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-3 text-lg" />
        </label>
      </div>
      {msg && <p role="alert" className="rounded-xl bg-red-600 p-4 text-lg font-semibold text-white">{msg}</p>}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-left">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="p-3">No.</th>
              <th>Repartidor</th>
              <th>{mode === "llegada" ? "Debe traer" : "Lleva"}</th>
              <th>Hora</th>
              <th>Estado</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const rec = mode === "llegada" ? r.arrival : r.departure;
              return (
                <tr key={r.driverId} className={`border-t border-slate-100 ${!r.active ? "bg-slate-100 text-slate-500" : rec && !rec.ok ? "bg-red-50" : ""}`}>
                  <td className="p-3 font-mono text-sm">{r.employeeNo ?? "—"}</td>
                  <td className="py-2">
                    <span className="flex items-center gap-3">
                      {r.hasPhoto ? (
                        // eslint-disable-next-line @next/next/no-img-element -- foto privada del repartidor
                        <img src={`/api/foto-repartidor/${r.driverId}`} alt="" className="h-10 w-10 rounded-full object-cover" />
                      ) : (
                        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-200 text-sm font-bold">{r.name.split(/\s+/).slice(0, 2).map((w) => w[0]).join("")}</span>
                      )}
                      <span className={`font-semibold ${!r.active ? "line-through" : ""}`}>{r.name}</span>
                    </span>
                  </td>
                  <td>{r.active ? (mode === "llegada" ? r.expected : "—") : ""}</td>
                  <td className="text-sm">{rec ? HM.format(new Date(rec.at)) : "—"}</td>
                  <td className="text-sm">
                    {!r.active ? (
                      <span className="rounded bg-slate-800 px-2 py-1 font-semibold text-white">⛔ SIN ACCESO{r.endDate ? ` · baja ${D.format(new Date(r.endDate))}` : ""}</span>
                    ) : !rec ? (
                      <span className="text-slate-400">Pendiente</span>
                    ) : rec.ok ? (
                      <span className="rounded bg-emerald-100 px-2 py-1 font-semibold text-emerald-800">✓ Cuadra</span>
                    ) : mode === "llegada" && r.arrival ? (
                      <span className="rounded bg-red-100 px-2 py-1 font-semibold text-red-800">⚠ {[r.arrival.extra && `${r.arrival.extra} ajeno(s)`, r.arrival.missing && `faltan ${r.arrival.missing}`].filter(Boolean).join(" · ")}</span>
                    ) : (
                      <span className="rounded bg-red-100 px-2 py-1 font-semibold text-red-800">⚠ Auditoría</span>
                    )}
                  </td>
                  <td className="pr-3 text-right">
                    {r.active && (
                      <Link href={`/recepcion/${mode}/${r.driverId}?via=lista`} className="inline-block rounded-lg bg-[#14213d] px-4 py-2 font-semibold text-white">
                        {rec ? "Repetir" : mode === "llegada" ? "Registrar llegada →" : "Revisar salida →"}
                      </Link>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {shown.length === 0 && <p className="p-6 text-center text-slate-500">Nadie coincide con la búsqueda.</p>}
      </div>
    </div>
  );
}
