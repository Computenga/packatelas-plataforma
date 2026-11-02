import { requireUser } from "@/lib/auth";
import { CLIENT_FAVORITES, CLIENT_NAV, ROLE_LABEL } from "@/lib/roles";
import { AppShell } from "@/components/app-shell";

export default async function ClienteLayout({ children }: LayoutProps<"/cliente">) {
  const user = await requireUser(["CLIENTE"]);
  return (
    <AppShell
      pushText="Activa las notificaciones: te avisamos al momento cuando entregamos, si algo no se pudo entregar, tus recolecciones y tus pagos. Elige cuáles en «Mis avisos»."
      title="Portal cliente"
      userName={user.name}
      roleLabel={ROLE_LABEL[user.role]}
      nav={CLIENT_NAV}
      ready={["/cliente", "/cliente/recolecciones", "/cliente/devoluciones", "/cliente/cuenta", "/cliente/facturas", "/cliente/mercadolibre", "/cliente/avisos", "/cliente/negocio"]}
      favorites={CLIENT_FAVORITES}
    >
      {children}
    </AppShell>
  );
}
