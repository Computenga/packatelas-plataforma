import { prisma, receiptTotals } from "@packatelas/db";
import { getSessionUser } from "@/lib/session";

/** CSV para cargar las transferencias de nómina en el banco (nombre, CLABE, monto, concepto). */
export async function GET(request: Request) {
  const user = await getSessionUser();
  if (user?.role !== "ADMIN") return new Response("No autorizado", { status: 401 });
  const key = new URL(request.url).searchParams.get("q") ?? "";
  if (!/^\d{4}-\d{2}-[12]$/.test(key)) return new Response("Quincena inválida", { status: 400 });
  const receipts = await prisma.payrollReceipt.findMany({
    where: { quincena: key, status: { in: ["APROBADO", "PAGADO"] } },
    include: { lines: true, employee: { select: { employeeNo: true, name: true, clabe: true, bank: true } } },
    orderBy: { employee: { employeeNo: "asc" } },
  });
  const esc = (v: string) => {
    const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v; // evita fórmulas al abrir en Excel
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const lines = [["No.", "Nombre", "CLABE", "Banco", "Monto", "Concepto", "Estado"].join(",")];
  for (const r of receipts) {
    lines.push([String(r.employee.employeeNo), r.employee.name, r.employee.clabe ?? "", r.employee.bank ?? "", receiptTotals(r.lines).net.toFixed(2), `NOMINA ${key}`, r.status].map(esc).join(","));
  }
  return new Response("﻿" + lines.join("\n"), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="nomina-${key}.csv"` },
  });
}
