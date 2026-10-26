import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@packatelas/db";
import { getSessionUser } from "@/lib/session";
import { PayrollReceiptView } from "@/components/payroll-receipt";
import { PrintButton } from "./print-button";

export const metadata: Metadata = { title: "Recibo de nómina", robots: { index: false } };

/** Recibo para ver o imprimir: el propio empleado (si ya está aprobado) o un administrador. */
export default async function ReciboPage({ params }: PageProps<"/recibo/[id]">) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const { id } = await params;
  const r = await prisma.payrollReceipt.findUnique({ where: { id }, include: { lines: true, employee: { select: { userId: true, employeeNo: true, name: true, rfc: true, curp: true, nss: true, position: true } } } });
  if (!r) notFound();
  const own = r.employee.userId === user.id && r.status !== "BORRADOR";
  if (user.role !== "ADMIN" && !own) notFound();
  return (
    <main className="mx-auto max-w-3xl space-y-4 px-4 py-6">
      <div className="flex justify-end print:hidden"><PrintButton /></div>
      <PayrollReceiptView r={r} />
    </main>
  );
}
