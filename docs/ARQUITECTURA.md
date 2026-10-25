# Arquitectura — Plataforma Packatelas

Plataforma única de operación, cobranza y administración de Packatelas. Reemplaza Shipday
y el admin actual, y absorbe RH, checador, flotilla, portal empleado y ruteador.

Requerimientos vivos: Google Sheet "Plataforma Packatelas – Requerimientos" (IDs A01, C01, R01…
se usan en commits, código y este documento).

## Principios

1. **Un solo sistema, un solo código.** Admin, cliente y repartidor son la misma app web; el
   menú y los permisos cambian según el rol del usuario.
2. **Sin dependencias de despacho externas.** Nada de una API key por cliente: los pedidos,
   repartidores, rutas y evidencias viven en nuestra base de datos.
3. **Todo pedido tiene historia.** Cada cambio de estado es un evento con quién, cuándo, dónde
   (GPS) y desde qué origen. El estado actual se deriva de los eventos.
4. **El dinero es un libro mayor.** Cargos y abonos son movimientos inmutables; el saldo es la
   suma. Correcciones = movimientos de ajuste, nunca editar o borrar.
5. **Funciona con mala señal.** La app del repartidor guarda acciones y fotos localmente y las
   sincroniza al recuperar conexión (R11).
6. **Importar y exportar todo** (I11).

## Componentes

```
                 ┌──────────────── VPS (Ubuntu + Coolify) ────────────────┐
 Navegador/PWA ─▶│  web (Next.js)  ── PostgreSQL                          │
 App Android   ─▶│     │  API + páginas por rol                           │
 (Capacitor)     │     └─ Redis (colas) ── worker (Node)                  │
                 │                           ├─ Gmail (pagos Fondeadora)   │
                 │  osrm + vroom (rutas)     ├─ MercadoLibre (tokens/sync) │
                 │                           ├─ PAC (CFDI), WhatsApp       │
                 └───────────────────────────┴─ notificaciones push ──────┘
                         Fotos/respaldos ─▶ Object Storage (S3)
```

| Pieza | Tecnología | Por qué |
|---|---|---|
| Web y API | Next.js (App Router) + TypeScript | Un solo proyecto para páginas y API; PWA instalable. |
| Base de datos | PostgreSQL 16 + Prisma | Relacional, transacciones para dinero, migraciones versionadas. |
| Colas y tareas | Redis + BullMQ, proceso `worker` | Gmail, ML, facturación y avisos corren fuera de la petición web, con reintentos. |
| Rutas | OSRM (tiempos/distancias) + VROOM (optimización) | Motor propio; ya usamos OSRM para nómina (A26). |
| Mapas | MapLibre + teselas OpenStreetMap; geocodificación con Google Places | Mapas sin costo por vista; Places para sugerencias de dirección precisas en MX (A03). |
| Archivos | S3 compatible (Vultr Object Storage) | Fotos de evidencia fuera del servidor. |
| App Android | Capacitor envolviendo la misma web | Ubicación en segundo plano, cámara/escáner, push (P03). |
| iPhone | PWA instalada + plan B de ubicación (P04) | Pantalla activa, GPS por evento, alerta de "sin ubicación". |
| Despliegue | Coolify en el VPS, desde GitHub | Despliegue por push, SSL automático, respaldos programados. |

## Estructura del repositorio

```
apps/web        Next.js: páginas admin/cliente/repartidor + API
apps/worker     Tareas en segundo plano (Gmail, ML, CFDI, avisos)
packages/db     Esquema Prisma, migraciones, cliente compartido, seed
docs/           Arquitectura, fases, decisiones
```

## Roles

| Rol | Ve |
|---|---|
| ADMIN | Todo, incluidos cobros, tarifas, usuarios y módulos internos. |
| OPERADOR | Escaneo, trazabilidad, devoluciones, alta de pedidos. |
| DESPACHADOR | Despacho, mapa, rutas, recolecciones, repartidores. |
| REPARTIDOR | Su turno, su ruta, entregas, recolecciones, escaneos. |
| CLIENTE | Sus envíos, recolecciones, estado de cuenta, facturas, cuentas ML. |
| EMPLEADO | Portal empleado (fase de módulos internos). |

Un usuario CLIENTE pertenece a un `Client`; un REPARTIDOR tiene un perfil `Driver`.

## Flujos clave

**Escaneo de envío ML (A01, F02).** QR de la etiqueta → `shipment_id` + `seller_id` →
cuenta ML del cliente → consulta del envío con su token → se crea el `Order` en la sucursal
según el enrutamiento (A02) → se genera el cargo según la tarifa del cliente → si el driver
Flex está vinculado (A05) se asigna al repartidor. Idempotente: escanear dos veces no duplica
pedido ni cargo.

**Entrega (R06/R07).** El repartidor marca entregado o fallido con foto, GPS y datos. Sin
señal, la acción queda en cola local con su hora real y se envía después. El evento se refleja
en ML cuando aplica (A12).

**Pago por transferencia (F04).** El worker lee los correos de Fondeadora en Gmail, extrae
monto, clave de rastreo y referencia; si la referencia identifica al cliente se registra el
abono; si no, va a la cola de pagos no identificados (F05). La clave de rastreo evita aplicar
un pago dos veces.

**Bloqueo por adeudo (F07).** Si el saldo pendiente supera la regla del cliente, sus
recolecciones quedan bloqueadas salvo exención temporal registrada en auditoría.

## Seguridad

- Contraseñas con scrypt; sesiones en base de datos con cookie httpOnly.
- 2FA para administradores (P09).
- Tokens de ML y llaves de terceros cifrados en la base (AES-256-GCM, llave en variable de
  entorno). Nunca en el repositorio.
- Auditoría de cambios sensibles (A19).
- Respaldos diarios de Postgres a Object Storage (P08).
