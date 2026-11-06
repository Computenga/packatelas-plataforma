"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { checkoutAction, type CheckoutState } from "./actions";

type P = { id: string; name: string; category: string; price: number; regular: number | null; stock: number; images: string[]; description: string | null };
type B = { id: string; name: string; address: string };
const money = (n: number) => new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(n);
const KEY = "pk_cart";

export function StoreClient({ products, branches, favor, cardEnabled, deliveryText }: { products: P[]; branches: B[]; favor: number; cardEnabled: boolean; deliveryText: string }) {
  const [cart, setCart] = useState<Record<string, number>>({});
  const [cat, setCat] = useState("Todos");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<CheckoutState, FormData>(checkoutAction, {});

  useEffect(() => {
    try { const raw = localStorage.getItem(KEY); if (raw) setCart(JSON.parse(raw)); } catch { /* sin almacenamiento */ }
  }, []);
  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(cart)); } catch { /* sin almacenamiento */ }
  }, [cart]);

  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const lines = Object.entries(cart).filter(([id, n]) => n > 0 && byId.has(id)).map(([id, qty]) => ({ p: byId.get(id)!, qty }));
  const total = Math.round(lines.reduce((s, l) => s + l.p.price * l.qty, 0) * 100) / 100;
  const count = lines.reduce((s, l) => s + l.qty, 0);
  const cats = ["Todos", ...Array.from(new Set(products.map((p) => p.category)))];
  const shown = products.filter((p) => (cat === "Todos" || p.category === cat) && (!q || p.name.toLowerCase().includes(q.toLowerCase())));
  const add = (id: string, d: number) => setCart((c) => ({ ...c, [id]: Math.max(0, Math.min(byId.get(id)?.stock ?? 0, 500, (c[id] ?? 0) + d)) }));
  const [view, setView] = useState<P | null>(null);
  const canSaldo = favor + 0.005 >= total && total > 0;

  return (
    <div className="pb-24">
      <div className="mb-3 flex flex-wrap gap-2">
        {cats.map((c) => (
          <button key={c} type="button" onClick={() => setCat(c)} className={`rounded-full px-3 py-1.5 text-sm ${c === cat ? "bg-brand text-white" : "bg-white ring-1 ring-slate-200"}`}>{c}</button>
        ))}
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar…" className="min-w-0 flex-1 rounded-full border border-slate-300 px-3 py-1.5 text-sm" />
      </div>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {shown.map((p) => (
          <li key={p.id} className="flex flex-col rounded-xl border border-slate-200 bg-white p-3">
            <button type="button" onClick={() => setView(p)} className="text-left" aria-label={`Ver ${p.name}`}>
              {p.images[0] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.images[0]} alt="" loading="lazy" className="aspect-square w-full rounded-lg bg-slate-50 object-contain" />
              ) : <div className="aspect-square w-full rounded-lg bg-slate-100" />}
              <p className="mt-2 line-clamp-3 text-sm font-medium">{p.name}</p>
            </button>
            <p className="mt-1 flex-1">
              <span className="font-bold text-brand">{money(p.price)}</span>
              {p.regular && <span className="ml-2 text-xs text-slate-400 line-through">{money(p.regular)}</span>}
              {p.stock <= 5 && <span className="block text-xs text-amber-700">Quedan {p.stock}</span>}
            </p>
            {cart[p.id] ? (
              <div className="mt-2 flex items-center justify-between rounded-lg border border-slate-300">
                <button type="button" onClick={() => add(p.id, -1)} className="px-3 py-1.5 text-lg" aria-label="Quitar uno">−</button>
                <span className="text-sm font-semibold">{cart[p.id]}</span>
                <button type="button" onClick={() => add(p.id, 1)} disabled={cart[p.id] >= p.stock} className="px-3 py-1.5 text-lg disabled:opacity-30" aria-label="Agregar uno">+</button>
              </div>
            ) : (
              <button type="button" onClick={() => add(p.id, 1)} className="mt-2 rounded-lg bg-brand py-1.5 text-sm font-semibold text-white">Agregar</button>
            )}
          </li>
        ))}
      </ul>

      {view && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-3 sm:items-center" role="dialog" aria-modal="true" aria-label={view.name} onClick={() => setView(null)}>
          <div className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
            {view.images.length > 0 && (
              <div className="flex snap-x gap-2 overflow-x-auto">
                {view.images.map((src) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={src} src={src} alt="" className="aspect-square w-full shrink-0 snap-center rounded-lg bg-slate-50 object-contain" />
                ))}
              </div>
            )}
            <h2 className="mt-3 text-lg font-bold">{view.name}</h2>
            <p className="mt-1">
              <span className="text-xl font-bold text-brand">{money(view.price)}</span>
              {view.regular && <span className="ml-2 text-sm text-slate-400 line-through">{money(view.regular)}</span>}
            </p>
            {view.description && <p className="mt-2 whitespace-pre-line text-sm text-slate-700">{view.description}</p>}
            <div className="mt-4 flex gap-2">
              <button type="button" onClick={() => { add(view.id, 1); setView(null); }} disabled={(cart[view.id] ?? 0) >= view.stock} className="flex-1 rounded-xl bg-brand py-3 font-semibold text-white disabled:opacity-50">Agregar al carrito</button>
              <button type="button" onClick={() => setView(null)} className="rounded-xl border border-slate-300 px-4">Cerrar</button>
            </div>
          </div>
        </div>
      )}

      {count > 0 && !open && (
        <button type="button" onClick={() => setOpen(true)} className="fixed inset-x-4 bottom-20 z-30 rounded-xl bg-brand px-4 py-3 text-base font-semibold text-white shadow-lg md:bottom-6 md:left-auto md:right-8 md:w-96">
          Ver carrito ({count}) · {money(total)}
        </button>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-3 sm:items-center" role="dialog" aria-modal="true" aria-label="Carrito">
          <div className="max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold">Tu pedido</h2>
              <button type="button" onClick={() => setOpen(false)} className="text-sm text-slate-500">Seguir comprando</button>
            </div>
            <ul className="mt-3 divide-y divide-slate-100 text-sm">
              {lines.map((l) => (
                <li key={l.p.id} className="flex items-center justify-between gap-2 py-2">
                  <span className="min-w-0 flex-1 truncate">{l.p.name}</span>
                  <span className="flex items-center gap-1">
                    <button type="button" onClick={() => add(l.p.id, -1)} className="h-7 w-7 rounded border border-slate-300">−</button>
                    <span className="w-6 text-center">{l.qty}</span>
                    <button type="button" onClick={() => add(l.p.id, 1)} disabled={l.qty >= l.p.stock} className="h-7 w-7 rounded border border-slate-300 disabled:opacity-30">+</button>
                  </span>
                  <span className="w-20 text-right tabular-nums">{money(l.p.price * l.qty)}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 flex justify-between border-t border-slate-200 pt-2 text-base font-bold"><span>Total</span><span>{money(total)}</span></p>

            <form action={action} className="mt-4 space-y-3" onSubmit={() => { try { localStorage.removeItem(KEY); } catch { /* */ } }}>
              <input type="hidden" name="cart" value={JSON.stringify(lines.map((l) => ({ productId: l.p.id, qty: l.qty })))} />
              <label className="block text-sm">
                <span className="font-medium">¿A dónde te lo llevamos?</span>
                <select name="branchId" required defaultValue={branches[0]?.id} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2">
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.name} · {b.address}</option>)}
                </select>
              </label>
              <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">🛵 {deliveryText}</p>
              <fieldset className="space-y-2 text-sm">
                <legend className="font-medium">Forma de pago</legend>
                <label className={`flex items-center gap-2 rounded-lg border p-2 ${canSaldo ? "border-slate-300" : "border-slate-200 text-slate-400"}`}>
                  <input type="radio" name="pay" value="saldo" disabled={!canSaldo} defaultChecked={canSaldo} className="accent-brand" />
                  Con mi saldo a favor ({money(Math.max(0, favor))}){!canSaldo && " · no alcanza"}
                </label>
                <label className={`flex items-center gap-2 rounded-lg border p-2 ${cardEnabled ? "border-slate-300" : "border-slate-200 text-slate-400"}`}>
                  <input type="radio" name="pay" value="tarjeta" disabled={!cardEnabled} defaultChecked={!canSaldo && cardEnabled} className="accent-brand" />
                  Con tarjeta (Mercado Pago){!cardEnabled && " · no disponible"}
                </label>
              </fieldset>
              {state.error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}
              <button disabled={pending || (!canSaldo && !cardEnabled) || !branches.length} className="w-full rounded-xl bg-brand py-3 font-semibold text-white disabled:opacity-50">
                {pending ? "Procesando…" : `Pagar ${money(total)}`}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
