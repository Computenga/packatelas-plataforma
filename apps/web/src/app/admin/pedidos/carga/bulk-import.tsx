"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { geocodeQuery, parseTable, readRows, type ImportRow } from "@/lib/bulk-import";
import { Badge, Button, ButtonLink, Card } from "@/components/ui";
import { createImportedOrders, geocodeBatch, type GeoAnswer } from "./actions";

type Client = { id: string; name: string; publicId: string; branches: { id: string; name: string }[] };
type Row = ImportRow & { geo?: GeoAnswer | "pending" };

const MAX = 500;
const CHUNK = 50;
const selectCls = "mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm";

export function BulkImport({ clients }: { clients: Client[] }) {
  const [clientId, setClientId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [raw, setRaw] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [batchId, setBatchId] = useState("");
  const [message, setMessage] = useState<{ error?: string; info?: string }>({});
  const [result, setResult] = useState<{ codes: string[]; already?: boolean } | null>(null);
  const [geocoding, setGeocoding] = useState(false);
  const [saving, startSaving] = useTransition();

  const client = clients.find((c) => c.id === clientId);
  const valid = rows?.filter((r) => !r.errors.length) ?? [];
  const invalid = (rows?.length ?? 0) - valid.length;
  const noPin = valid.filter((r) => r.data.lat == null && !(r.geo && r.geo !== "pending")).length;

  async function onFile(file: File | undefined) {
    if (!file) return;
    if (/\.(xlsx|xls)$/i.test(file.name)) {
      setMessage({ error: "Para archivos de Excel: selecciona las celdas, cópialas y pégalas abajo, o guárdalo como CSV." });
      return;
    }
    setRaw(await file.text());
    setMessage({});
  }

  async function review() {
    setResult(null);
    const parsed = readRows(parseTable(raw));
    if (parsed.error) return setMessage({ error: parsed.error });
    if (parsed.rows.length > MAX) return setMessage({ error: `Máximo ${MAX} pedidos por carga; divide el archivo.` });
    const list: Row[] = parsed.rows.map((r) => ({ ...r, geo: !r.errors.length && r.data.lat == null ? "pending" : undefined }));
    setRows(list);
    setBatchId(crypto.randomUUID());
    setMessage(parsed.unknown.length ? { info: `Columnas ignoradas: ${parsed.unknown.join(", ")}` } : {});

    // Ubicación en el mapa para los que no traen coordenadas, por bloques para ver el avance.
    const todo = list.map((r, i) => [r, i] as const).filter(([r]) => r.geo === "pending");
    if (!todo.length) return;
    setGeocoding(true);
    try {
      for (let s = 0; s < todo.length; s += CHUNK) {
        const part = todo.slice(s, s + CHUNK);
        const hits = await geocodeBatch(part.map(([r]) => geocodeQuery(r.data)));
        setRows((prev) => {
          if (!prev) return prev;
          const next = [...prev];
          part.forEach(([, i], k) => (next[i] = { ...next[i], geo: hits[k] }));
          return next;
        });
      }
    } catch {
      setMessage({ error: "No se pudieron ubicar todas las direcciones; puedes crear los pedidos y ponerles el pin después." });
      setRows((prev) => prev?.map((r) => (r.geo === "pending" ? { ...r, geo: null } : r)) ?? prev);
    } finally {
      setGeocoding(false);
    }
  }

  function create() {
    if (!client || !rows) return;
    startSaving(async () => {
      const payload = valid.map((r) => {
        const g = r.geo && r.geo !== "pending" ? r.geo : null;
        return { ...r.data, lat: r.data.lat ?? g?.lat, lng: r.data.lng ?? g?.lng };
      });
      const r = await createImportedOrders({ batchId, clientId: client.id, branchId: branchId || undefined, rows: payload });
      if (r.error) return setMessage({ error: r.error });
      setResult({ codes: r.codes ?? [], already: r.already });
      setRows(null);
      setRaw("");
      setMessage({});
    });
  }

  if (result) {
    const n = result.codes.length;
    return (
      <Card>
        <p className="text-lg font-semibold text-emerald-700" role="status">
          {result.already ? "Esta carga ya se había registrado" : `Listo: ${n} pedido(s) creados`}
        </p>
        {n > 0 && <p className="mt-1 text-sm text-slate-600">Del {result.codes[0]} al {result.codes[n - 1]}, para {client?.name}.</p>}
        <div className="mt-4 flex gap-2">
          <ButtonLink href="/admin/despacho">Ir a despacho</ButtonLink>
          <Button variant="secondary" onClick={() => setResult(null)}>Otra carga</Button>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="font-medium text-slate-700">Cliente</span>
            <select value={clientId} onChange={(e) => { setClientId(e.target.value); setBranchId(""); }} className={selectCls} required>
              <option value="" disabled>Elige un cliente</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.publicId})</option>)}
            </select>
          </label>
          <label className="block text-sm">
            <span className="font-medium text-slate-700">Sucursal de recolección</span>
            <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className={selectCls} disabled={!client}>
              <option value="">La principal del cliente</option>
              {client?.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>
        </div>

        <label className="mt-4 block text-sm">
          <span className="font-medium text-slate-700">Pedidos</span>
          <textarea
            value={raw}
            onChange={(e) => { setRaw(e.target.value); setRows(null); }}
            rows={8}
            spellCheck={false}
            placeholder={"Destinatario\tTeléfono\tDirección\tColonia\tCP\tAlcaldía / municipio\nAna López\t5512345678\tLago Zurich 245\tAmpliación Granada\t11529\tMiguel Hidalgo"}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs"
          />
        </label>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
          <label className="cursor-pointer text-brand hover:underline">
            Subir CSV
            <input type="file" accept=".csv,.tsv,.txt,.xlsx,.xls" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
          </label>
          <Link href="/admin/pedidos/carga/plantilla" prefetch={false} className="text-brand hover:underline">Descargar plantilla</Link>
          <span className="text-slate-500">
            Obligatorias: Destinatario y Dirección. Opcionales: Teléfono, Colonia, CP, Alcaldía, Estado, Referencias, Contenido, Latitud, Longitud.
          </span>
        </div>
        {message.error && <p role="alert" className="mt-3 text-sm text-red-600">{message.error}</p>}
        {message.info && <p className="mt-3 text-sm text-slate-500">{message.info}</p>}
        <div className="mt-4">
          <Button onClick={review} disabled={!raw.trim() || geocoding || saving}>Revisar</Button>
        </div>
      </Card>

      {rows && (
        <Card
          title={`${valid.length} listo(s) para crear${invalid ? ` · ${invalid} con error (se omiten)` : ""}`}
          actions={
            <Button onClick={create} disabled={!client || !valid.length || geocoding || saving}>
              {saving ? "Creando…" : geocoding ? "Ubicando direcciones…" : `Crear ${valid.length} pedido(s)`}
            </Button>
          }
        >
          {!client && <p className="mb-3 text-sm text-amber-700">Elige el cliente para poder crear los pedidos.</p>}
          {noPin > 0 && !geocoding && (
            <p className="mb-3 text-sm text-amber-700">
              {noPin} sin ubicación en el mapa: se crean igual y puedes poner el pin desde el pedido.
            </p>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-2 py-2">Renglón</th>
                  <th className="px-2 py-2">Destinatario</th>
                  <th className="px-2 py-2">Dirección</th>
                  <th className="px-2 py-2">CP</th>
                  <th className="px-2 py-2">Mapa</th>
                  <th className="px-2 py-2">Revisión</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => (
                  <tr key={r.line} className={r.errors.length ? "bg-red-50" : ""}>
                    <td className="px-2 py-1.5 text-slate-500">{r.line}</td>
                    <td className="px-2 py-1.5">{r.data.recipientName ?? "—"}</td>
                    <td className="max-w-md truncate px-2 py-1.5">{[r.data.addressLine, r.data.neighborhood, r.data.city].filter(Boolean).join(", ")}</td>
                    <td className="px-2 py-1.5">{r.data.zip ?? "—"}</td>
                    <td className="px-2 py-1.5"><GeoCell row={r} /></td>
                    <td className="px-2 py-1.5 text-red-700">{r.errors.join(" · ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-slate-500">
            Si algo no cuadra, corrige el texto de arriba y vuelve a dar Revisar. Los pedidos quedan en <Link href="/admin/despacho" className="text-brand">despacho</Link> para asignarlos.
          </p>
        </Card>
      )}
    </div>
  );
}

function GeoCell({ row }: { row: Row }) {
  if (row.errors.length) return <span className="text-slate-400">—</span>;
  if (row.data.lat != null) return <Badge tone="green">Coordenadas</Badge>;
  if (row.geo === "pending") return <span className="text-slate-400">Buscando…</span>;
  if (!row.geo) return <Badge tone="amber">Sin ubicar</Badge>;
  return (
    <span title={row.geo.label}>
      <Badge tone={row.geo.precise ? "green" : "amber"}>{row.geo.precise ? "Ubicado" : "Aproximado"}</Badge>
    </span>
  );
}
