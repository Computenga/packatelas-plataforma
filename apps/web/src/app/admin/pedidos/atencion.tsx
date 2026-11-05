import Link from "next/link";
import { ATTENTION, attentionCounts, attentionReason, attentionWhere, prisma, type AttentionKey } from "@packatelas/db";
import { STATUS_LABEL, STATUS_TONE } from "@/lib/format";
import { Badge } from "@/components/ui";
import { AssignSelect } from "./assign-select";

/** «Necesitan atención»: vistas guardadas con conteo y el motivo de cada pedido (lo primero que ve oficina). */
export async function Atencion({ sel, canAssign }: { sel: AttentionKey | "todos"; canAssign: boolean }) {
  const now = new Date();
  const counts = await attentionCounts(prisma, now);
  const where = sel === "todos" ? { OR: ATTENTION.map((a) => attentionWhere(a.key, now)) } : attentionWhere(sel, now);
  const [orders, drivers] = await Promise.all([
    prisma.order.findMany({
      where,
      orderBy: { updatedAt: "asc" },
      take: 200,
      include: { client: { select: { name: true } }, driver: { select: { user: { select: { name: true } } } } },
    }),
    prisma.driver.findMany({ where: { active: true, user: { active: true } }, select: { id: true, onDuty: true, user: { select: { name: true } } }, orderBy: [{ onDuty: "desc" }] }),
  ]);
  const driverOpts = drivers.map((d) => ({ id: d.id, name: d.user.name, onDuty: d.onDuty })).sort((a, b) => Number(b.onDuty) - Number(a.onDuty) || a.name.localeCompare(b.name, "es"));
  const chip = (key: string, label: string, n: number) => {
    const on = key === sel;
    return (
      <Link
        key={key}
        href={`/admin/pedidos?vista=atencion&motivo=${key}`}
        className={`whitespace-nowrap rounded-full border-[1.5px] px-3 py-1.5 text-sm font-semibold ${on ? "border-brand bg-brand text-white" : "border-slate-200 bg-white"}`}
      >
        {label} <b className={on ? "text-accent" : n ? "text-red-600" : "text-slate-400"}>{n}</b>
      </Link>
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {chip("todos", "Todos los que necesitan atención", counts.all)}
        {ATTENTION.map((a) => chip(a.key, a.label, counts.by[a.key]))}
      </div>
      <div className="overflow-x-auto rounded-xl bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 text-[13px] text-slate-500">
            <tr>
              {["Folio", "Tienda", "Destino", "Repartidor", "Estado", "Por qué está aquí"].map((h) => (
                <th key={h} className="whitespace-nowrap px-4 py-2.5 font-semibold">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => {
              const why = attentionReason(o, now);
              const grave = why.includes("falta grave") || why.includes("falta la foto");
              return (
                <tr key={o.id} className={`border-b border-slate-100 last:border-0 ${grave ? "bg-red-50/60 shadow-[inset_5px_0_0_#dc2626]" : ""}`}>
                  <td className="whitespace-nowrap px-4 py-2.5"><Link href={`/admin/pedidos/${o.id}`} className="font-bold tabular-nums hover:underline">{o.code}</Link></td>
                  <td className="px-4">{o.client.name}</td>
                  <td className="px-4">{[o.neighborhood, o.zip].filter(Boolean).join(" ") || o.addressLine}</td>
                  <td className="px-4">
                    {canAssign && ["CREATED", "ASSIGNED", "RESCHEDULED", "FAILED"].includes(o.status)
                      ? <AssignSelect orderId={o.id} current={o.driverId} drivers={driverOpts} />
                      : (o.driver?.user.name ?? "—")}
                  </td>
                  <td className="px-4"><Badge tone={STATUS_TONE[o.status]}>{STATUS_LABEL[o.status]}</Badge></td>
                  <td className={`whitespace-nowrap px-4 ${grave ? "font-semibold text-red-700" : ""}`}>{why}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {orders.length === 0 && <p className="p-8 text-center text-sm text-slate-500">Nada pendiente aquí. 👌</p>}
      </div>
    </div>
  );
}
