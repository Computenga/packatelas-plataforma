import { prisma } from "@packatelas/db";
import { fecha, mxn } from "@/lib/format";
import { Card } from "./ui";

/** Adeudos del empleado (p. ej. reparaciones por mal uso) [A24, A25]. */
export async function MyCharges({ userId }: { userId: string }) {
  const emp = await prisma.employee.findUnique({ where: { userId }, select: { id: true } });
  if (!emp) return null;
  const charges = await prisma.employeeCharge.findMany({ where: { employeeId: emp.id }, orderBy: { createdAt: "desc" }, take: 20 });
  if (!charges.length) return null;
  return (
    <Card title="Mis cargos">
      <ul className="divide-y divide-slate-100 text-sm">
        {charges.map((c) => (
          <li key={c.id} className="flex justify-between gap-2 py-1.5">
            <span>{c.description}<span className="block text-xs text-slate-500">{fecha(c.createdAt)}</span></span>
            <span className="font-semibold">{mxn(c.amount)}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
