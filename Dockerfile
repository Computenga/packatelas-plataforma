# Imagen de producción de la app web. Coolify la construye desde GitHub.
FROM node:22-slim AS base
RUN corepack enable && apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @packatelas/db generate && pnpm --filter web build

# Imagen ligera para correr migraciones al desplegar (servicio "migrate" en docker-compose).
FROM build AS migrate
WORKDIR /app/packages/db
CMD ["sh", "-c", "npx prisma migrate deploy && npx tsx src/bootstrap.ts"]

FROM base AS web
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public
RUN mkdir -p /data/uploads && chown -R node:node /data/uploads
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
