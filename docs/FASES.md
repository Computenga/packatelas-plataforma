# Fases de entrega

Cada fase termina con algo usable en producción. Los IDs vienen del Sheet de requerimientos.

## Fase 0 — Cimientos (en curso)

- Arquitectura, estructura del repositorio, modelo de datos completo.
- Inicio de sesión, roles y paneles base (P01, A13).
- PWA instalable (P02).

## Fase 1 — Reemplazo de Shipday y del admin operativo

Objetivo: operar un día completo sin Shipday ni el admin actual.

- Clientes, sucursales y cuentas ML conectadas por el propio cliente (A15, C01, C02, I01).
- Escaneo de envíos ML con cámara y PDA, enrutamiento a sucursal, asignación Flex
  (A01, A02, A05, I02, P06).
- Alta manual y carga masiva con sugerencias de dirección (A03).
- Despacho, mapa en vivo y optimización de rutas (A04, A07, A08).
- App repartidor: turno, ruta ordenada por ubicación actual, escaneo al cargar y de paquetes
  externos, navegación, entrega/fallido con evidencia, recolecciones, modo sin conexión,
  ubicación en vivo (R01–R04, R06–R11, R14).
- Trazabilidad, devoluciones, fallidos, sincronización con ML (A09–A12).
- Cargos al escanear, saldos, abonos manuales, bloqueo por adeudo (F01–F03, F06, F07).
- Auditoría (A19). Importar/exportar y migración del sistema actual (I11, A21).
- App Android con Capacitor (P03), plan B iPhone (P04), push (P05).
- Infraestructura: VPS, Coolify, respaldos, seguridad (P07–P10).

## Fase 2 — Cobranza automática y portal cliente completo

- Abonos automáticos desde Gmail/Fondeadora y cola de no identificados (F04, F05, I03).
- Portal cliente: envíos, recolecciones, estado de cuenta, referencia de pago, evidencias,
  devoluciones (C03, C05–C09).
- Mercado Pago con comisión configurable (I09).
- Facturación automática con PAC (F09, I05, I10, C10).
- Notificaciones al cliente y al comprador final; recordatorios de pago (C11, C12, F10, I04).
- Prepago/crédito, antigüedad de saldos (F08, F11).

## Fase 3 — Módulos internos

- RH, checador, flotilla, portal empleado (A22–A25).
- Ruteador/análisis de nómina y pago a repartidores (A26, A16).
- Informes, carga quemada, salud operativa (A17, A18, A20).

## Fase 4 — Extras

- Crear envíos manuales desde el portal cliente (C04).
- Integraciones con tiendas y API para clientes grandes (I06, I08).
- Marca blanca y detalles (P11).
