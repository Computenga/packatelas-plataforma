import { packageText, type MlSaleItem } from "@packatelas/db";
import { mxn } from "@/lib/format";
import { Card } from "@/components/ui";

type Sale = {
  mlShipmentId: bigint | null;
  mlItems: unknown;
  mlSaleTotal: { toString(): string } | null;
  pkgWeightG: number | null;
  pkgLengthCm: number | null;
  pkgWidthCm: number | null;
  pkgHeightCm: number | null;
  mlDetailAt: Date | null;
};

/** Qué compró el comprador en MercadoLibre: artículos, cantidad, precio, peso y medidas [I14]. */
export function MlSaleCard({ order }: { order: Sale }) {
  if (!order.mlShipmentId) return null;
  const items = Array.isArray(order.mlItems) ? (order.mlItems as MlSaleItem[]) : [];
  const pkg = packageText(order);
  return (
    <Card title="Compra en MercadoLibre">
      {items.length === 0 && !pkg ? (
        <p className="text-sm text-slate-500">
          {order.mlDetailAt ? "MercadoLibre no compartió el detalle de esta venta." : "Se completa en unos minutos al sincronizar con MercadoLibre."}
        </p>
      ) : (
        <div className="space-y-3 text-sm">
          {items.length > 0 && (
            <ul className="divide-y divide-slate-100">
              {items.map((it, k) => (
                <li key={k} className="flex items-start justify-between gap-3 py-2 first:pt-0">
                  <span className="min-w-0">
                    <span className="block font-medium">{it.title}</span>
                    {(it.variation || it.sku) && (
                      <span className="block text-xs text-slate-500">{[it.variation, it.sku ? `SKU ${it.sku}` : null].filter(Boolean).join(" · ")}</span>
                    )}
                  </span>
                  <span className="shrink-0 text-right tabular-nums">
                    <span className="block">{it.quantity} ×{it.unitPrice != null ? ` ${mxn(it.unitPrice)}` : ""}</span>
                    {it.unitPrice != null && it.quantity > 1 && <span className="block text-xs text-slate-500">{mxn(it.unitPrice * it.quantity)}</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {order.mlSaleTotal != null && (
            <p className="flex justify-between border-t border-slate-100 pt-2 font-semibold">
              <span>Total de la venta</span>
              <span className="tabular-nums">{mxn(order.mlSaleTotal)}</span>
            </p>
          )}
          {pkg && <p className="text-slate-600">📦 Paquete: {pkg}</p>}
        </div>
      )}
    </Card>
  );
}
