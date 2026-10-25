import { requireUser } from "@/lib/auth";
import { adminNavFor, ROLE_LABEL, STAFF_ROLES } from "@/lib/roles";
import { AppShell } from "@/components/app-shell";

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const user = await requireUser(STAFF_ROLES);
  return (
    <AppShell
      title="Administración"
      userName={user.name}
      roleLabel={ROLE_LABEL[user.role]}
      nav={adminNavFor(user.role)}
      ready={["/admin", "/admin/escanear", "/admin/pedidos", "/admin/clientes", "/admin/repartidores", "/admin/usuarios", "/admin/auditoria"]}
    >
      {children}
    </AppShell>
  );
}
