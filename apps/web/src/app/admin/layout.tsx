import Link from "next/link";
import { prisma } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import { ADMIN_FAVORITES, adminNavFor, ROLE_LABEL, STAFF_ROLES } from "@/lib/roles";
import { AppShell } from "@/components/app-shell";

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const user = await requireUser(STAFF_ROLES);
  const needs2fa =
    user.role === "ADMIN" && !(await prisma.user.findUnique({ where: { id: user.id }, select: { totpSecret: true } }))?.totpSecret;
  return (
    <AppShell
      title="Administración"
      userName={user.name}
      roleLabel={ROLE_LABEL[user.role]}
      nav={adminNavFor(user.role)}
      favorites={ADMIN_FAVORITES}
      ready={["/admin", "/admin/escanear", "/admin/despacho", "/admin/pedidos", "/admin/recolecciones", "/admin/devoluciones", "/admin/clientes", "/admin/repartidores", "/admin/cobros", "/admin/usuarios", "/admin/auditoria", "/admin/seguridad", "/admin/informes", "/admin/avisos", "/admin/salud", "/admin/personal", "/admin/checador", "/admin/nomina", "/admin/flotilla", "/admin/datos", "/admin/arranque"]}
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
