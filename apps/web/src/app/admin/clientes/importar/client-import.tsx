"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { normalizePublicId } from "@packatelas/db/public-id";
import { parseTable } from "@/lib/bulk-import";
import { readClientRows, type ClientRow } from "@/lib/client-import";
import { mxn } from "@/lib/format";
import { Badge, Button, ButtonLink, Card } from "@/components/ui";
import { importClientsAction, previewClients } from "./actions";
import type { ClientImportSummary } from "@packatelas/db";

export function ClientImport() {
  const [raw, setRaw] = useState("");
  const [negativeIsDebt, setNegativeIsDebt] = useState(false);
  const [rows, setRows] = useState<ClientRow[] | null>(null);
  const [existing, setExisting] = useState<{ ids: Set<string>; withBalance: Set<string> }>({ ids: new Set(), withBalance: new Set() });
  const [batchId, setBatchId] = useState("");
  const [msg, setMsg] = useState<{ error?: string; info?: string }>({});
  const [summary, setSummary] = useState<ClientImportSummary | null>(null);
  const [busy, start] = useTransition();

  const valid = rows?.filter((r) => !r.errors.length) ?? [];
  const invalid = (rows?.length ?? 0) - valid.length;
  const newCount = valid.filter((r) => !existing.ids.has(r.data.publicId!)).length;
  const totalBalance = valid.reduce((s, r) => s + (r.data.openingBalance && !existing.withBalance.has(r.data.publicId!) ? r.data.openingBalance : 0), 0);

  function review() {
    setSummary(null);
    const r = readClientRows(parseTable(raw), normalizePublicId, { negativeIsDebt });
    if (r.error) return setMsg({ error: r.error });
    setRows(r.rows);
    setBatchId(crypto.randomUUID());
    setMsg(r.unknown.length ? { info: `Columnas ignoradas: ${r.unknown.join(", ")}` } : {});
    start(async () => {
      const ids = r.rows.map((x) => x.data.publicId).filter((x): x is string => !!x);
      const p = await previewClients([...new Set(ids)]);
      setExisting({ ids: new Set(p.existing), withBalance: new Set(p.withBalance) });
    });
  }

  function run() {
    start(async () => {
      const res = await importClientsAction({ batchId, rows: valid.map((r) => r.data) });
      if (res.error) return setMsg({ error: res.error });
      setSummary(res.summary!);
      setRows(null);
      setRaw("");
      setMsg({});
    });
  }

  if (summary) {
    return (
      <Card>
        <p role="status" className="text-lg font-semibold text-emerald-700">
          {summary.status === "already" ? "Esta carga ya se había registrado" : "Migración lista"}
        </p>
        <ul className="mt-2 space-y-1 text-sm text-slate-700">
          <li>{summary.created.length} cliente(s) nuevos</li>
          <li>{summary.updated.length} actualizado(s)</li>
          <li>{summary.balances} saldo(s) inicial(es) registrados</li>
          {summary.balanceSkipped.length > 0 && (
            <li className="text-amber-800">
              {summary.balanceSkipped.length} ya tenían saldo inicial y no se tocó: {summary.balanceSkipped.join(", ")}. Si hay diferencia, usa un ajuste en Cobros.
            </li>
          )}
        </ul>
        <div className="mt-4 flex gap-2">
          <ButtonLink href="/admin/clientes">Ver clientes</ButtonLink>
          <Button variant="secondary" onClick={() => setSummary(null)}>Otra carga</Button>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <label className="block text-sm">
          <span className="font-medium text-slate-700">Clientes</span>
          <textarea
            value={raw}
            onChange={(e) => { setRaw(e.target.value); setRows(null); }}
            rows={8}
            spellCheck={false}
            placeholder={"ID\tNombre\tTeléfono\tTarifa\tSaldo\ncmx00114\tTienda Ejemplo\t5512345678\t75\t1500"}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs"
          />
        </label>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
          <label className="cursor-pointer text-brand hover:underline">
            Subir CSV
            <input type="file" accept=".csv,.tsv,.txt" className="sr-only" onChange={async (e) => { const f = e.target.files?.[0]; if (f) { setRaw(await f.text()); setRows(null); } }} />
          </label>
          <Link href="/admin/clientes/importar/plantilla" prefetch={false} className="text-brand hover:underline">Descargar plantilla</Link>
          <span className="text-slate-500">Obligatorias: ID (cmx…) y Nombre. El saldo es lo que el cliente debe hoy.</span>
        </div>
        <label className="mt-3 flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={negativeIsDebt} onChange={(e) => { setNegativeIsDebt(e.target.checked); setRows(null); }} className="accent-brand" />
          En el archivo el adeudo aparece en negativo (−1,500 = debe $1,500)
        </label>
        {msg.error && <p role="alert" className="mt-3 text-sm text-red-600">{msg.error}</p>}
        {msg.info && <p className="mt-3 text-sm text-slate-500">{msg.info}</p>}
        <div className="mt-4">
          <Button onClick={review} disabled={!raw.trim() || busy}>Revisar</Button>
        </div>
      </Card>

      {rows && (
        <Card
          title={`${valid.length} listo(s): ${newCount} nuevo(s), ${valid.length - newCount} a actualizar${invalid ? ` · ${invalid} con error (se omiten)` : ""}`}
          actions={<Button onClick={run} disabled={!valid.length || busy}>{busy ? "Procesando…" : `Importar ${valid.length}`}</Button>}
        >
          <p className="mb-3 text-sm text-slate-600">
            Saldo inicial a registrar: <span className="font-semibold">{mxn(totalBalance)}</span> (positivo = por cobrar).
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-2 py-2">Renglón</th><th className="px-2 py-2">ID</th><th className="px-2 py-2">Nombre</th>
                  <th className="px-2 py-2">Tarifa</th><th className="px-2 py-2">Saldo</th><th className="px-2 py-2">Acción</th><th className="px-2 py-2">Revisión</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => {
                  const id = r.data.publicId;
                  const exists = id ? existing.ids.has(id) : false;
                  const balDone = id ? existing.withBalance.has(id) : false;
                  return (
                    <tr key={r.line} className={r.errors.length ? "bg-red-50" : ""}>
                      <td className="px-2 py-1.5 text-slate-500">{r.line}</td>
                      <td className="px-2 py-1.5 font-mono text-xs">{id ?? "—"}</td>
                      <td className="px-2 py-1.5">{r.data.name || "—"}</td>
                      <td className="px-2 py-1.5">{r.data.tariffAmount != null ? mxn(r.data.tariffAmount) : "—"}</td>
                      <td className={`px-2 py-1.5 ${balDone ? "text-slate-400 line-through" : ""}`}>
                        {r.data.openingBalance != null ? mxn(r.data.openingBalance) : "—"}
                      </td>
                      <td className="px-2 py-1.5">
                        {r.errors.length ? null : <Badge tone={exists ? "blue" : "green"}>{exists ? "Actualizar" : "Nuevo"}</Badge>}
                        {balDone && r.data.openingBalance != null && <span className="ml-1 text-xs text-slate-500">saldo ya registrado</span>}
                      </td>
                      <td className="px-2 py-1.5 text-red-700">{r.errors.join(" · ")}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
