import type { Metadata } from "next";
import Link from "next/link";
import { accountState, getClientBalance, getCreditRules, getMpSettings, mpConfigured, prisma } from "@packatelas/db";
import { requireClient } from "@/lib/client-scope";
import { fecha, mxn } from "@/lib/format";
import { Card } from "@/components/ui";
import { MlConnect } from "@/components/ml-connect";
import { PayCard } from "./pay-card";

export const metadata: Metadata = { title: "Estado de cuenta" };

const DAYS = ["", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];
const TYPE_LABEL = { CHARGE: "Envío", PAYMENT: "Pago recibido", FEE: "Comisión", ADJUSTMENT: "Ajuste" } as const;

export default async function CuentaPage({ searchParams }: PageProps<"/cliente/cuenta">) {
  const { clientId } = await requireClient();
  const pago = (await searchParams).pago;
  const [client, balance, state, rules, entries, mp] = await Promise.all([
    prisma.client.findUniqueOrThrow({ where: { id: clientId }, select: { name: true, paymentReference: true, creditLimit: true, creditMode: true } }),
    getClientBalance(prisma, clientId),
    accountState(prisma, clientId),
    getCreditRules(prisma),
    prisma.ledgerEntry.findMany({ where: { clientId }, orderBy: { createdAt: "desc" }, take: 200, include: { order: { select: { id: true, code: true } } } }),
    getMpSettings(prisma),
  ]);
  const cardOn = mp.enabled && mpConfigured();
  const PAGO_MSG: Record<string, [string, string]> = {
    ok: ["bg-emerald-50 text-emerald-800", "Pago con tarjeta aprobado. Se abona a tu saldo en unos segundos."],
    pendiente: ["bg-amber-50 text-amber-800", "Tu pago quedó pendiente en Mercado Pago. Se abonará cuando lo aprueben."],
    error: ["bg-red-50 text-red-800", "El pago no se completó. No se hizo ningún cargo a tu saldo."],
  };
  const msg = typeof pago === "string" ? PAGO_MSG[pago] : undefined;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-xl font-bold">Estado de cuenta</h1>
      {msg && <p className={`rounded-lg px-4 py-3 text-sm ${msg[0]}`}>{msg[1]}</p>}
      <Card title="Mis cuentas de MercadoLibre">
        <MlConnect clientId={clientId} self />
      </Card>
      <div className={`rounded-xl p-5 ${balance.gt(0) ? "bg-red-50" : "bg-emerald-50"}`}>
        <p className="text-sm text-slate-600">{balance.gt(0) ? "Saldo por pagar" : "Saldo a favor"}</p>
        <p className={`text-3xl font-bold ${balance.gt(0) ? "text-red-700" : "text-emerald-700"}`}>{mxn(balance.abs())}</p>
        {client.creditMode === "WEEKLY_CREDIT" && (
          <p className="mt-2 text-sm text-slate-700">
            Crédito semanal: liquida lo de cada semana antes del {DAYS[rules.cutWeekday]} para que tus recolecciones sigan activas.
            {state.overdue > 0 && <> Pendiente de la semana anterior: <strong>{mxn(state.overdue)}</strong>.</>}
          </p>
        )}
        {state.blocked && (
          <p className="mt-2 text-sm font-medium text-red-700">
            Tus recolecciones están en pausa. Se reactivan al pagar{" "}
            {client.creditMode === "WEEKLY_CREDIT" && state.overdue > 0 ? mxn(state.overdue) : client.creditLimit ? `hasta dejar el saldo bajo ${mxn(client.creditLimit)}` : "tu saldo"}.
          </p>
        )}
      </div>

      <Card title="Cómo pagar">
        <p className="text-sm text-slate-700">Haz tu transferencia y escribe esta referencia en el concepto para que se aplique a tu cuenta:</p>
        <p className="my-3 rounded-lg bg-slate-100 py-3 text-center font-mono text-2xl font-bold tracking-wider">{client.paymentReference}</p>
        <p className="text-xs text-slate-500">Los datos bancarios te los comparte Packatelas. Los pagos se reflejan aquí al confirmarse.</p>
      </Card>

      {cardOn && (
        <Card title="Pagar con tarjeta">
          <PayCard balance={balance.gt(0) ? Number(balance) : 0} min={mp.minAmount} tiers={mp.tiers} />
        </Card>
      )}

      <Card title="Tiendas en línea y API">
        <p className="text-sm text-slate-600">Si vendes en WooCommerce o Shopify, o tienes un sistema propio, tus pedidos pueden entrar solos como envíos.</p>
        <Link href="/cliente/api" className="mt-2 inline-block text-sm text-brand hover:underline">Configurar →</Link>
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
