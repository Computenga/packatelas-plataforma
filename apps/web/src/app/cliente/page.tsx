import type { Metadata } from "next";
import { getClientBalance, prisma } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import { Stat, mxn } from "@/components/stat";

export const metadata: Metadata = { title: "Mis envíos" };

export default async function ClienteHome() {
  const user = await requireUser(["CLIENTE"]);
  if (!user.clientId) {
    return <p className="text-slate-600">Tu usuario aún no está ligado a una cuenta de cliente. Contacta a Packatelas.</p>;
  }
  const clientId = user.clientId;

  const [client, inProgress, delivered, balance] = await Promise.all([
    prisma.client.findUniqueOrThrow({ where: { id: clientId }, select: { name: true, paymentReference: true } }),
    prisma.order.count({ where: { clientId, status: { in: ["CREATED", "ASSIGNED", "OUT_FOR_DELIVERY"] } } }),
    prisma.order.count({ where: { clientId, status: "DELIVERED" } }),
    getClientBalance(prisma, clientId),
  ]);

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-xl font-bold">{client.name}</h1>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <Stat label="En camino" value={inProgress} tone="amber" />
        <Stat label="Entregados" value={delivered} tone="green" />
        <Stat
          label={balance.gt(0) ? "Saldo por pagar" : "Saldo a favor"}
          value={mxn(balance.abs().toString())}
          tone={balance.gt(0) ? "red" : "green"}
          hint={`Referencia de pago: ${client.paymentReference}`}
        />
      </div>
    </div>
  );
}
