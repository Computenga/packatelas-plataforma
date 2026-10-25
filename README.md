# Plataforma Packatelas

Operación, entregas, cobranza y administración de Packatelas en un solo sistema:
panel de administración, portal cliente y app de repartidor (web instalable + Android).

- Arquitectura: [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md)
- Fases de entrega: [docs/FASES.md](docs/FASES.md)
- Requerimientos: Google Sheet "Plataforma Packatelas – Requerimientos"

## Desarrollo local

Requisitos: Node 22, pnpm 10, PostgreSQL 16 y Redis.

```bash
pnpm install
cp .env.example packages/db/.env && cp .env.example apps/web/.env.local
pnpm db:migrate        # crea las tablas
pnpm db:seed           # usuarios de prueba (contraseña: packatelas)
pnpm dev               # http://localhost:3000
```

Usuarios de prueba: `admin`, `operador`, `despacho`, `repartidor`, `cliente`.

## Pruebas

```bash
pnpm test              # pruebas del libro mayor (requiere la base local)
```

## Despliegue

Coolify en el VPS construye `docker-compose.yml` desde la rama `main`. Variables requeridas
en Coolify: `POSTGRES_PASSWORD`, `ENCRYPTION_KEY`.
