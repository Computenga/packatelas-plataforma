import { requireUser } from "@/lib/auth";
import { DRIVER_NAV, ROLE_LABEL } from "@/lib/roles";
import { AppShell } from "@/components/app-shell";

export default async function RepartidorLayout({ children }: LayoutProps<"/repartidor">) {
  const user = await requireUser(["REPARTIDOR"]);
  return (
    <AppShell
      title="Repartidor"
      userName={user.name}
      roleLabel={ROLE_LABEL[user.role]}
      nav={DRIVER_NAV}
      ready={["/repartidor"]}
      mobileBottomNav
    >
      {children}
    </AppShell>
  );
}
