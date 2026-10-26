import type { Role } from "@packatelas/db";

export type NavItem = { href: string; label: string };

export const ROLE_LABEL: Record<Role, string> = {
  ADMIN: "Administrador",
  OPERADOR: "Operador",
  DESPACHADOR: "Despachador",
  REPARTIDOR: "Repartidor",
  CLIENTE: "Cliente",
  EMPLEADO: "Empleado",
};

/** Página de inicio de cada rol. */
export function homeFor(role: Role): string {
  switch (role) {
    case "REPARTIDOR":
      return "/repartidor";
    case "CLIENTE":
      return "/cliente";
    case "EMPLEADO":
      return "/empleado";
    default:
      return "/admin";
  }
}

/** Roles con acceso al panel de administración y qué secciones ve cada uno. */
export const STAFF_ROLES: Role[] = ["ADMIN", "OPERADOR", "DESPACHADOR"];

const ADMIN_NAV: (NavItem & { roles: Role[] })[] = [
  { href: "/admin", label: "Resumen", roles: STAFF_ROLES },
  { href: "/admin/escanear", label: "Escanear", roles: ["ADMIN", "OPERADOR"] },
  { href: "/admin/despacho", label: "Despacho", roles: ["ADMIN", "DESPACHADOR"] },
  { href: "/admin/pedidos", label: "Pedidos", roles: STAFF_ROLES },
  { href: "/admin/recolecciones", label: "Recolecciones", roles: ["ADMIN", "DESPACHADOR"] },
  { href: "/admin/devoluciones", label: "Devoluciones", roles: ["ADMIN", "OPERADOR"] },
  { href: "/admin/clientes", label: "Clientes", roles: ["ADMIN"] },
  { href: "/admin/repartidores", label: "Repartidores", roles: ["ADMIN", "DESPACHADOR"] },
  { href: "/admin/cobros", label: "Cobros", roles: ["ADMIN"] },
  { href: "/admin/usuarios", label: "Usuarios", roles: ["ADMIN"] },
  { href: "/admin/personal", label: "Personal", roles: ["ADMIN"] },
  { href: "/admin/checador", label: "Checador", roles: ["ADMIN"] },
  { href: "/admin/informes", label: "Informes", roles: ["ADMIN"] },
  { href: "/admin/avisos", label: "Avisos", roles: ["ADMIN"] },
  { href: "/admin/salud", label: "Salud operativa", roles: ["ADMIN"] },
  { href: "/admin/auditoria", label: "Auditoría", roles: ["ADMIN"] },
  { href: "/admin/seguridad", label: "Seguridad", roles: STAFF_ROLES },
];

export function adminNavFor(role: Role): NavItem[] {
  return ADMIN_NAV.filter((i) => i.roles.includes(role)).map(({ href, label }) => ({ href, label }));
}

export const CLIENT_NAV: NavItem[] = [
  { href: "/cliente", label: "Mis envíos" },
  { href: "/cliente/recolecciones", label: "Recolecciones" },
  { href: "/cliente/devoluciones", label: "Devoluciones" },
  { href: "/cliente/cuenta", label: "Estado de cuenta" },
  { href: "/cliente/mercadolibre", label: "Cuentas ML" },
];

export const DRIVER_NAV: NavItem[] = [
  { href: "/repartidor", label: "Mi ruta" },
  { href: "/repartidor/escanear", label: "Escanear" },
  { href: "/repartidor/recolecciones", label: "Recolecciones" },
];
