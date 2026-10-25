import { requireUser } from "@/lib/auth";
import { ROLE_LABEL } from "@/lib/roles";
import { AppShell } from "@/components/app-shell";

export default async function EmpleadoLayout({ children }: LayoutProps<"/empleado">) {
  const user = await requireUser(["EMPLEADO"]);
  return (
    <AppShell
      title="Portal empleado"
      userName={user.name}
      roleLabel={ROLE_LABEL[user.role]}
      nav={[{ href: "/empleado", label: "Inicio" }]}
      ready={["/empleado"]}
      mobileBottomNav
    >
      {children}
    </AppShell>
  );
}
