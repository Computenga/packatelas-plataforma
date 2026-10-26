import { prisma } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import { DRIVER_NAV, ROLE_LABEL } from "@/lib/roles";
import { AppShell } from "@/components/app-shell";
import { DriverRuntime } from "./driver-runtime";

export default async function RepartidorLayout({ children }: LayoutProps<"/repartidor">) {
  const user = await requireUser(["REPARTIDOR"]);
  const driver = await prisma.driver.findUnique({ where: { userId: user.id }, select: { onDuty: true } });
  return (
    <AppShell
      title="Repartidor"
      userName={user.name}
      roleLabel={ROLE_LABEL[user.role]}
      nav={DRIVER_NAV}
      ready={["/repartidor", "/repartidor/escanear"]}
      mobileBottomNav
    >
      <div className="mx-auto max-w-md">
        <DriverRuntime onDuty={!!driver?.onDuty} />
        {children}
      </div>
    </AppShell>
  );
}
