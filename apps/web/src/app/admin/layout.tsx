import Link from "next/link";
import { prisma, taskCounters, todayMx, unreadWhatsapp } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import { ADMIN_FAVORITES, adminNavFor, ROLE_LABEL, STAFF_ROLES } from "@/lib/roles";
import { AppShell } from "@/components/app-shell";

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const user = await requireUser(STAFF_ROLES);
  const [me, unassigned, tickets, returning, gateBad, tasks, waUnread] = await Promise.all([
    prisma.user.findUnique({ where: { id: user.id }, select: { totpSecret: true } }),
    prisma.order.count({ where: { kind: { in: ["DELIVERY", "RETURN"] }, source: { not: "IMPORT" }, driverId: null, status: { in: ["CREATED", "RESCHEDULED"] } } }),
    prisma.ticket.count({ where: { status: { in: ["OPEN", "IN_PROGRESS"] } } }),
    prisma.order.count({ where: { status: "RETURNING" } }),
    prisma.gateCheck.count({ where: { ymd: todayMx(), ok: false } }),
    taskCounters(prisma, user.id),
    user.role === "ADMIN" ? unreadWhatsapp(prisma) : Promise.resolve(0),
  ]);
  const needs2fa = user.role === "ADMIN" && !me?.totpSecret;
  // Pendientes junto a cada sección del menú.
  const counts = {
    "/admin/despacho": unassigned,
    "/admin/soporte": tickets,
    "/admin/devoluciones": returning,
    "/admin/recepcion": gateBad,
    "/admin/tareas": tasks.mine + tasks.toReview,
    "/admin/whatsapp": waUnread,
  };
  return (
    <AppShell
      title="Administración"
      userName={user.name}
      roleLabel={ROLE_LABEL[user.role]}
      nav={adminNavFor(user.role)}
      favorites={ADMIN_FAVORITES}
      counts={counts}
      ready={["/admin", "/admin/escanear", "/admin/despacho", "/admin/pedidos", "/admin/inventario", "/admin/recolecciones", "/admin/devoluciones", "/admin/recepcion", "/admin/clientes", "/admin/crm", "/admin/whatsapp", "/admin/soporte", "/admin/tienda", "/admin/repartidores", "/admin/tareas", "/admin/cobros", "/admin/usuarios", "/admin/auditoria", "/admin/seguridad", "/admin/informes", "/admin/avisos", "/admin/salud", "/admin/personal", "/admin/personal/altas", "/admin/checador", "/admin/nomina", "/admin/flotilla", "/admin/datos", "/admin/arranque", "/ayuda/admin"]}
    >
      {needs2fa && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Protege tu cuenta de administrador:{" "}
          <Link href="/admin/seguridad" className="font-semibold underline">activa la verificación en dos pasos</Link>.
        </div>
      )}
      {children}
    </AppShell>
  );
}
