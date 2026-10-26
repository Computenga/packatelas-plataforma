import type { Metadata } from "next";
import Link from "next/link";
import { getClientBalance, isPickupBlocked, prisma } from "@packatelas/db";
import { requireClient } from "@/lib/client-scope";
import { fecha, mxn } from "@/lib/format";
import { Card } from "@/components/ui";

export const metadata: Metadata = { title: "Estado de cuenta" };

const TYPE_LABEL = { CHARGE: "Envío", PAYMENT: "Pago recibido", FEE: "Comisión", ADJUSTMENT: "Ajuste" } as const;

export default async function CuentaPage() {
  const { clientId } = await requireClient();
  const [client, balance, blocked, entries] = await Promise.all([
    prisma.client.findUniqueOrThrow({ where: { id: clientId }, select: { name: true, paymentReference: true, creditLimit: true } }),
    getClientBalance(prisma, clientId),
    isPickupBlocked(prisma, clientId),
    prisma.ledgerEntry.findMany({ where: { clientId }, orderBy: { createdAt: "desc" }, take: 200, include: { order: { select: { id: true, code: true } } } }),
  ]);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-xl font-bold">Estado de cuenta</h1>
      <div className={`rounded-xl p-5 ${balance.gt(0) ? "bg-red-50" : "bg-emerald-50"}`}>
        <p className="text-sm text-slate-600">{balance.gt(0) ? "Saldo por pagar" : "Saldo a favor"}</p>
        <p className={`text-3xl font-bold ${balance.gt(0) ? "text-red-700" : "text-emerald-700"}`}>{mxn(balance.abs())}</p>
        {blocked && <p className="mt-2 text-sm text-red-700">Tus recolecciones están en pausa hasta que el saldo baje de {mxn(client.creditLimit ?? 0)}.</p>}
      </div>

      <Card title="Cómo pagar">
        <p className="text-sm text-slate-700">Haz tu transferencia y escribe esta referencia en el concepto para que se aplique a tu cuenta:</p>
        <p className="my-3 rounded-lg bg-slate-100 py-3 text-center font-mono text-2xl font-bold tracking-wider">{client.paymentReference}</p>
        <p className="text-xs text-slate-500">Los datos bancarios te los comparte Packatelas. Los pagos se reflejan aquí al confirmarse.</p>
      </Card>

      <Card title="Movimientos">
        <ul className="divide-y divide-slate-100 text-sm">
          {entries.map((e) => (
            <li key={e.id} className="flex items-start justify-between gap-3 py-2">
              <span>
                <span className="font-medium">{TYPE_LABEL[e.type]}</span>{" "}
                {e.order ? (
                  <Link href={`/cliente/envio/${e.order.id}`} className="font-mono text-xs text-brand">{e.order.code}</Link>
                ) : (
                  <span className="text-slate-600">{e.description.replace(/^(Abono( manual)?|Ajuste)\s*·?\s*/, "")}</span>
                )}
                <span className="block text-xs text-slate-500">{fecha(e.createdAt)}</span>
              </span>
              <span className={`tabular-nums ${Number(e.amount) < 0 ? "text-emerald-700" : ""}`}>{mxn(e.amount)}</span>
            </li>
          ))}
          {entries.length === 0 && <li className="py-4 text-center text-slate-500">Sin movimientos</li>}
        </ul>
      </Card>
    </div>
  );
}
