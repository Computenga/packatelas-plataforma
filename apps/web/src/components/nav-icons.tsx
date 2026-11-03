import type { ReactNode } from "react";

// Íconos del menú inferior (celular).
export const NAV_ICONS: Record<string, ReactNode> = {
  "/cliente": <path d="M4 6.5 10 3.5l6 3v7l-6 3-6-3zM4 6.5l6 3 6-3M10 9.5v7" />,
  "/cliente/recolecciones": <path d="M3 6h9v8H3zM12 9h3l2 2.5V14h-5M6 16.5a1.5 1.5 0 1 0 0-.01M14 16.5a1.5 1.5 0 1 0 0-.01" />,
  "/cliente/cuenta": <path d="M3 6.5h14v9H3zM3 9.5h14M6 13h3" />,
  "/cliente/tienda": <path d="M4 7h12l-1 9H5zM7.5 7V5.5a2.5 2.5 0 0 1 5 0V7" />,
  "/cliente/soporte": <path d="M10 17a7 7 0 1 0-6.1-3.6L3 17l3.6-.9A7 7 0 0 0 10 17zM8 8.2a2 2 0 1 1 2.6 1.9c-.4.2-.6.5-.6.9v.5M10 13.3v.2" />,
  "/repartidor": <path d="M10 17s-5-4.6-5-8.5a5 5 0 0 1 10 0C15 12.4 10 17 10 17zM10 10a1.6 1.6 0 1 0 0-3.2 1.6 1.6 0 0 0 0 3.2z" />,
  "/repartidor/escanear": (
    <>
      <path d="M3 7V4h3M14 4h3v3M17 13v3h-3M6 16H3v-3" />
      <path d="M6 10h8" />
    </>
  ),
  "/repartidor/recolecciones": <path d="M3 7.5 10 4l7 3.5v6L10 17l-7-3.5zM3 7.5 10 11l7-3.5M10 11v6M6.5 5.8l7 3.5" />,
  "/repartidor/moto": (
    <>
      <circle cx="5" cy="13.5" r="2.5" />
      <circle cx="15" cy="13.5" r="2.5" />
      <path d="M5 13.5 8 8h4l3 5.5M10.5 8 9 5H7M12 8l1-2h2" />
    </>
  ),
  "/repartidor/perfil": <path d="M10 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM4 17c.6-3 3-4.5 6-4.5s5.4 1.5 6 4.5" />,
  "/mecanico": <path d="M12.5 3.5a3.5 3.5 0 0 0-3.3 4.6L3.5 13.8a1.6 1.6 0 0 0 2.3 2.3l5.7-5.7a3.5 3.5 0 0 0 4.6-3.3l-2 2-2.2-.6-.6-2.2z" />,
  "/mecanico/documentos": <path d="M6 3h6l3 3v11H6zM12 3v3h3M8 10h5M8 13h5" />,
  "/mecanico/motos": (
    <>
      <circle cx="5" cy="13.5" r="2.5" />
      <circle cx="15" cy="13.5" r="2.5" />
      <path d="M5 13.5 8 8h4l3 5.5M10.5 8 9 5H7M12 8l1-2h2" />
    </>
  ),
  "/empleado": <path d="M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM10 6v4l2.5 2" />,
  "/admin": <path d="M3 9.5 10 4l7 5.5V16a1 1 0 0 1-1 1h-3.5v-4.5h-5V17H4a1 1 0 0 1-1-1z" />,
  "/admin/escanear": (
    <>
      <path d="M3 7V4h3M14 4h3v3M17 13v3h-3M6 16H3v-3" />
      <path d="M6 10h8" />
    </>
  ),
  "/admin/flotilla": (
    <>
      <circle cx="5" cy="13.5" r="2.5" />
      <circle cx="15" cy="13.5" r="2.5" />
      <path d="M5 13.5 8 8h4l3 5.5M10.5 8 9 5H7M12 8l1-2h2" />
    </>
  ),
  "/admin/despacho": <path d="M3 6h9v8H3zM12 9h3l2 2.5V14h-5M6 16.5a1.5 1.5 0 1 0 0-.01M14 16.5a1.5 1.5 0 1 0 0-.01" />,
  "/admin/pedidos": <path d="M4 6.5 10 3.5l6 3v7l-6 3-6-3zM4 6.5l6 3 6-3M10 9.5v7" />,
};
export const NAV_DOT = <circle cx="10" cy="10" r="3" />;

export function NavIcon({ children }: { children: ReactNode }) {
  return (
    <svg aria-hidden viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
      {children}
    </svg>
  );
}

/** Nombres cortos para que quepan abajo en el celular. */
export const NAV_SHORT: Record<string, string> = {
  "/cliente": "Envíos",
  "/cliente/recolecciones": "Recolectas",
  "/cliente/cuenta": "Mi cuenta",
  "/repartidor/recolecciones": "Recolectas",
  "/mecanico/documentos": "Docs",
};
