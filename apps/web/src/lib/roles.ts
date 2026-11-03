import type { Role } from "@packatelas/db";

/** `section`: título del grupo en el menú (los renglones seguidos con la misma sección van juntos). */
export type NavItem = { href: string; label: string; section?: string };

export const ROLE_LABEL: Record<Role, string> = {
  ADMIN: "Administrador",
  OPERADOR: "Operador",
  DESPACHADOR: "Despachador",
  REPARTIDOR: "Repartidor",
  CLIENTE: "Cliente",
  EMPLEADO: "Empleado",
  MECANICO: "Mecánico",
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
    case "MECANICO":
      return "/mecanico";
    default:
      return "/admin";
  }
}

/** Roles con acceso al panel de administración y qué secciones ve cada uno. */
export const STAFF_ROLES: Role[] = ["ADMIN", "OPERADOR", "DESPACHADOR"];

const OP = "Operación", CLI = "Clientes", PER = "Personal", GES = "Gestión", SIS = "Sistema";
const ADMIN_NAV: (NavItem & { roles: Role[] })[] = [
  { section: OP, href: "/admin", label: "Resumen", roles: STAFF_ROLES },
  { section: OP, href: "/admin/escanear", label: "Escanear", roles: ["ADMIN", "OPERADOR"] },
  { section: OP, href: "/admin/despacho", label: "Despacho", roles: ["ADMIN", "DESPACHADOR"] },
  { section: OP, href: "/admin/pedidos", label: "Pedidos", roles: STAFF_ROLES },
  { section: OP, href: "/admin/recolecciones", label: "Recolecciones", roles: ["ADMIN", "DESPACHADOR"] },
  { section: OP, href: "/admin/inventario", label: "Inventario", roles: ["ADMIN", "DESPACHADOR"] },
  { section: OP, href: "/admin/devoluciones", label: "Devoluciones", roles: ["ADMIN", "OPERADOR", "DESPACHADOR"] },
  { section: OP, href: "/admin/repartidores", label: "Repartidores", roles: ["ADMIN", "DESPACHADOR"] },
  { section: CLI, href: "/admin/clientes", label: "Clientes", roles: ["ADMIN"] },
  { section: CLI, href: "/admin/crm", label: "CRM", roles: ["ADMIN"] },
  { section: CLI, href: "/admin/cobros", label: "Cobros", roles: ["ADMIN"] },
  { section: CLI, href: "/admin/soporte", label: "Soporte", roles: STAFF_ROLES },
  { section: CLI, href: "/admin/tienda", label: "Tienda de insumos", roles: STAFF_ROLES },
  { section: PER, href: "/admin/personal", label: "Personal", roles: ["ADMIN"] },
  { section: PER, href: "/admin/personal/altas", label: "Altas de repartidores", roles: ["DESPACHADOR"] },
  { section: PER, href: "/admin/checador", label: "Checador", roles: ["ADMIN"] },
  { section: PER, href: "/admin/nomina", label: "Nómina", roles: ["ADMIN"] },
  { section: PER, href: "/admin/flotilla", label: "Flotilla", roles: ["ADMIN"] },
  { section: GES, href: "/admin/informes", label: "Informes", roles: ["ADMIN"] },
  { section: GES, href: "/admin/datos", label: "Importar y exportar", roles: ["ADMIN"] },
  { section: GES, href: "/admin/avisos", label: "Avisos", roles: ["ADMIN"] },
  { section: GES, href: "/admin/usuarios", label: "Usuarios", roles: ["ADMIN"] },
  { section: SIS, href: "/admin/salud", label: "Salud operativa", roles: ["ADMIN"] },
  { section: SIS, href: "/admin/auditoria", label: "Auditoría", roles: ["ADMIN"] },
  { section: SIS, href: "/admin/seguridad", label: "Seguridad", roles: STAFF_ROLES },
  { section: SIS, href: "/admin/arranque", label: "Arranque", roles: ["ADMIN"] },
];

/** Accesos fijos abajo en el celular (admin y operación). Agrega aquí más rutas de ADMIN_NAV. */
export const ADMIN_FAVORITES = ["/admin/escanear", "/admin/flotilla"];

export function adminNavFor(role: Role): NavItem[] {
  return ADMIN_NAV.filter((i) => i.roles.includes(role)).map(({ href, label, section }) => ({ href, label, section }));
}

export const CLIENT_NAV: NavItem[] = [
  { section: "Envíos", href: "/cliente", label: "Mis envíos" },
  { section: "Envíos", href: "/cliente/recolecciones", label: "Recolecciones" },
  { section: "Envíos", href: "/cliente/devoluciones", label: "Devoluciones" },
  { section: "Dinero", href: "/cliente/cuenta", label: "Estado de cuenta y pagos" },
  { section: "Dinero", href: "/cliente/facturas", label: "Facturas y datos fiscales" },
  { section: "Dinero", href: "/cliente/tienda", label: "Tienda de insumos" },
  { section: "Mi negocio", href: "/cliente/mercadolibre", label: "Conectar Mercado Libre" },
  { section: "Mi negocio", href: "/cliente/negocio", label: "Direcciones y accesos" },
  { section: "Mi negocio", href: "/cliente/avisos", label: "Mis avisos" },
  { section: "Mi negocio", href: "/cliente/soporte", label: "Ayuda y soporte" },
];

/** Accesos fijos abajo en el celular para las tiendas; el resto está en el menú ☰. */
export const CLIENT_FAVORITES = ["/cliente", "/cliente/recolecciones", "/cliente/cuenta"];

export const DRIVER_NAV: NavItem[] = [
  { href: "/repartidor", label: "Mi ruta" },
  { href: "/repartidor/escanear", label: "Escanear" },
  { href: "/repartidor/recolecciones", label: "Recolecciones" },
  { href: "/repartidor/moto", label: "Moto" },
  { href: "/repartidor/perfil", label: "Perfil" },
];

export const MECHANIC_NAV: NavItem[] = [
  { href: "/mecanico", label: "Fallas" },
  { href: "/mecanico/documentos", label: "Documentos" },
  { href: "/mecanico/motos", label: "Motos" },
];
