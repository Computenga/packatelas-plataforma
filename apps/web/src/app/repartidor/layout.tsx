import Link from "next/link";
import { prisma } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import { DRIVER_NAV, ROLE_LABEL } from "@/lib/roles";
import { AppShell } from "@/components/app-shell";
import { DriverRuntime } from "./driver-runtime";
import { FlexGate } from "./flex-gate";

export default async function RepartidorLayout({ children }: LayoutProps<"/repartidor">) {
  const user = await requireUser(["REPARTIDOR"]);
  const driver = await prisma.driver.findUnique({ where: { userId: user.id }, select: { onDuty: true, flexExempt: true, _count: { select: { flexIdentities: true } } } });
  const needsFlex = !!driver && !driver.flexExempt && driver._count.flexIdentities === 0;
  return (
    <AppShell
      title="Repartidor"
      userName={user.name}
      roleLabel={ROLE_LABEL[user.role]}
      nav={DRIVER_NAV}
      ready={["/repartidor", "/repartidor/escanear", "/repartidor/recolecciones", "/repartidor/moto", "/repartidor/tareas", "/repartidor/perfil"]}
      mobileBottomNav
    >
      <div className="mx-auto max-w-md">
        <DriverRuntime onDuty={!!driver?.onDuty} />
        {/* En turno no se le bloquea a media ruta: aviso; al terminar ya no puede iniciar otro sin vincular. */}
        {needsFlex && (driver?.onDuty ? (
          <Link href="/repartidor/perfil" className="mb-3 block rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-800">
            <strong>Vincula tu Mercado Libre Flex</strong>: es obligatorio. Sin esto tus pedidos de Flex no se te asignan y no podrás iniciar tu siguiente turno. Toca aquí →
          </Link>
        ) : <FlexGate />)}
        {children}
      </div>
    </AppShell>
  );
}
