import { audit, prisma } from "@packatelas/db";
import { getSessionUser } from "@/lib/session";
import { csvResponse } from "@/lib/csv";
import { readRange } from "@/lib/report-range";

const FMT = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Mexico_City", dateStyle: "short", timeStyle: "short" });
const fmt = (d: Date | null | undefined) => (d ? FMT.format(d) : "");
const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "");
const money = (v: unknown) => (v == null ? "" : Number(v).toFixed(2));
const yn = (b: boolean) => (b ? "Sí" : "No");

const TYPE: Record<string, string> = { CHARGE: "Cargo", PAYMENT: "Abono", FEE: "Comisión", ADJUSTMENT: "Ajuste" };
const PSTATUS: Record<string, string> = { UNIDENTIFIED: "Sin identificar", APPLIED: "Aplicado", REJECTED: "Rechazado" };
const PICKUP: Record<string, string> = { SCHEDULED: "Programada", ASSIGNED: "Asignada", COLLECTED: "Recolectada", FAILED: "Fallida", CANCELLED: "Cancelada", BLOCKED: "Bloqueada por adeudo" };

/** Exportación de datos en CSV [I11]. Los encabezados de clientes y personal son los que aceptan sus importadores. */
export async function GET(request: Request) {
  const user = await getSessionUser();
  if (user?.role !== "ADMIN") return new Response("No autorizado", { status: 401 });
  const sp = Object.fromEntries(new URL(request.url).searchParams);
  const { fromYmd, toYmd, range } = readRange(sp);
  const created = { gte: range.from, lt: range.to };
  const tipo = sp.tipo;
  let rows: unknown[][];
  let name = tipo;

  if (tipo === "clientes") {
    const [clients, balances] = await Promise.all([
      prisma.client.findMany({ orderBy: { publicId: "asc" }, include: { branches: { where: { active: true }, orderBy: { createdAt: "asc" }, take: 1 } } }),
      prisma.ledgerEntry.groupBy({ by: ["clientId"], _sum: { amount: true } }),
    ]);
    const bal = new Map(balances.map((b) => [b.clientId, Number(b._sum.amount ?? 0)]));
    rows = [
      ["ID", "Nombre", "Contacto", "Teléfono", "Correo", "RFC", "Razón social", "Régimen", "CP fiscal", "Uso CFDI", "Tarifa", "Flex dinámica", "Cobro activo", "Activo", "Exento hasta", "Motivo exención", "Dirección de recolección", "Referencia de pago", "Saldo"],
      ...clients.map((c) => [
        c.publicId, c.name, c.contactName, c.phone, c.email, c.rfc, c.legalName, c.taxRegime, c.taxZip, c.cfdiUse, money(c.tariffAmount),
        yn(c.tariffMode === "FLEX_DYNAMIC_PLUS_FIXED"), yn(c.chargingEnabled), yn(c.active), day(c.pickupExemptUntil), c.pickupExemptNote,
        c.branches[0]?.address ?? "", c.paymentReference, money(bal.get(c.id) ?? 0),
      ]),
    ];
  } else if (tipo === "movimientos") {
    const list = await prisma.ledgerEntry.findMany({ where: { createdAt: created }, orderBy: { createdAt: "asc" }, include: { client: { select: { publicId: true, name: true } }, order: { select: { code: true } } } });
    rows = [["Fecha", "ID cliente", "Cliente", "Tipo", "Monto", "Descripción", "Envío"],
      ...list.map((l) => [fmt(l.createdAt), l.client.publicId, l.client.name, TYPE[l.type] ?? l.type, money(l.amount), l.description, l.order?.code ?? ""])];
    name = `movimientos-${fromYmd}_${toYmd}`;
  } else if (tipo === "pagos") {
    const list = await prisma.payment.findMany({ where: { receivedAt: created }, orderBy: { receivedAt: "asc" }, include: { client: { select: { publicId: true, name: true } } } });
    rows = [["Recibido", "ID cliente", "Cliente", "Método", "Origen", "Estado", "Monto", "Comisión", "Referencia", "Remitente", "Nota"],
      ...list.map((p) => [fmt(p.receivedAt), p.client?.publicId ?? "", p.client?.name ?? "", p.method, p.source, PSTATUS[p.status] ?? p.status, money(p.amount), money(p.fee), p.reference, p.senderName, p.note])];
    name = `pagos-${fromYmd}_${toYmd}`;
  } else if (tipo === "recolecciones") {
    const list = await prisma.pickup.findMany({
      where: { scheduledFor: created }, orderBy: { scheduledFor: "asc" },
      include: { client: { select: { publicId: true, name: true } }, branch: { select: { name: true } }, driver: { include: { user: { select: { name: true } } } } },
    });
    rows = [["Programada", "ID cliente", "Cliente", "Sucursal", "Estado", "Automática", "Repartidor", "Esperados", "Recolectados", "Recolectada", "Nota"],
      ...list.map((p) => [fmt(p.scheduledFor), p.client.publicId, p.client.name, p.branch.name, PICKUP[p.status] ?? p.status, yn(p.automatic), p.driver?.user.name ?? "", p.expectedCount ?? "", p.collectedCount ?? "", fmt(p.collectedAt), p.note])];
    name = `recolecciones-${fromYmd}_${toYmd}`;
  } else if (tipo === "devoluciones") {
    const list = await prisma.returnCustody.findMany({ where: { createdAt: created }, orderBy: { createdAt: "asc" }, include: { order: { select: { code: true, status: true, client: { select: { publicId: true, name: true } } } } } });
    const ST: Record<string, string> = { PENDING_RECEIPT: "Por recibir", IN_WAREHOUSE: "En bodega", RETURNED_TO_SELLER: "Devuelto al vendedor" };
    rows = [["Envío", "ID cliente", "Cliente", "Estado", "Recibido en bodega", "Devuelto al vendedor"],
      ...list.map((r) => [r.order.code, r.order.client.publicId, r.order.client.name, ST[r.status] ?? r.status, fmt(r.receivedAt), fmt(r.returnedAt)])];
    name = `devoluciones-${fromYmd}_${toYmd}`;
  } else if (tipo === "personal") {
    const list = await prisma.employee.findMany({ orderBy: { employeeNo: "asc" } });
    rows = [["no_empleado", "nombre", "rfc", "curp", "nss", "puesto", "area", "rol", "estatus", "fecha_ingreso", "fecha_baja", "salario_diario", "clabe", "banco", "telefono", "correo", "hora_entrada", "dias_laborales", "minutos_comida", "checadas", "moto_tipo", "domicilio"],
      ...list.map((e) => [e.employeeNo, e.name, e.rfc, e.curp, e.nss, e.position, e.area, e.kind, e.status, day(e.hireDate), day(e.endDate), money(e.dailySalary), e.clabe, e.bank, e.phone, e.email, e.entryTime, e.workdays.join(" "), e.lunchMinutes, e.punchesPerDay, e.motoType, e.address])];
  } else {
    return new Response("Tipo de exportación desconocido", { status: 400 });
  }
  await audit(prisma, { actorUserId: user.id, action: "data.exported", entity: "Export", summary: `Exportó ${name} (${rows.length - 1} filas)` }).catch(() => {});
  return csvResponse(rows, `${name}.csv`);
}
