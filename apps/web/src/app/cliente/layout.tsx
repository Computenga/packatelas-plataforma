import { requireUser } from "@/lib/auth";
import { CLIENT_NAV, ROLE_LABEL } from "@/lib/roles";
import { AppShell } from "@/components/app-shell";

export default async function ClienteLayout({ children }: LayoutProps<"/cliente">) {
  const user = await requireUser(["CLIENTE"]);
  return (
    <AppShell
      push={false}
      title="Portal cliente"
      userName={user.name}
      roleLabel={ROLE_LABEL[user.role]}
      nav={CLIENT_NAV}
      ready={["/cliente", "/cliente/recolecciones", "/cliente/devoluciones", "/cliente/cuenta", "/cliente/facturas", "/cliente/mercadolibre"]}
      mobileBottomNav
    >
      {children}
    </AppShell>
  );
}
