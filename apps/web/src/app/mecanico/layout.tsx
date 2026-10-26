import { requireUser } from "@/lib/auth";
import { MECHANIC_NAV, ROLE_LABEL } from "@/lib/roles";
import { AppShell } from "@/components/app-shell";

export default async function MecanicoLayout({ children }: LayoutProps<"/mecanico">) {
  const user = await requireUser(["MECANICO", "ADMIN"]);
  return (
    <AppShell title="Taller" userName={user.name} roleLabel={ROLE_LABEL[user.role]} nav={MECHANIC_NAV} ready={MECHANIC_NAV.map((n) => n.href)} mobileBottomNav>
      {children}
    </AppShell>
  );
}
