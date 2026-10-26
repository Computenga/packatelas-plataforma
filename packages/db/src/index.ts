import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.ts";

export * from "../generated/prisma/client.ts";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL no está definido");
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

// Una sola instancia por proceso, creada al primer uso (no al importar: así `next build`
// no necesita base de datos) y reutilizada en desarrollo pese a la recarga en caliente.
function getClient(): PrismaClient {
  globalForPrisma.prisma ??= createClient();
  return globalForPrisma.prisma;
}

export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const client = getClient();
    const value = Reflect.get(client, prop, client);
    return typeof value === "function" ? value.bind(client) : value;
  },
});

export * from "./ledger.ts";
export * from "./password.ts";
export * from "./scan.ts";
export * from "./orders.ts";
export * from "./dispatch.ts";
export * from "./routing.ts";
export * from "./returns.ts";
export * from "./payments.ts";
export * from "./pickups.ts";
export * from "./fondeadora.ts";
export * from "./failures.ts";
export * from "./migration.ts";
export * from "./signups.ts";
export * from "./crypto.ts";
export * from "./totp.ts";
export * from "./ml-routes.ts";
export * from "./credit.ts";
export * from "./reports.ts";
export * from "./notifications.ts";
