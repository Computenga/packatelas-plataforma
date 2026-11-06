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
export * from "./ml-sale.ts";
export * from "./insurance.ts";
export * from "./helpdesk.ts";
export * from "./guest.ts";
export * from "./ml-buyer-message.ts";
export * from "./legacy-sync.ts";
export * from "./store.ts";
export * from "./counters.ts";
export * from "./manual-status.ts";
export { parseEmployees, parsePunches, type ParsedEmployees } from "./personnel-import.ts";
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
export * from "./drive.ts";
export * from "./crm.ts";
export * from "./municipios.ts";
export * from "./store-links.ts";
export * from "./faltas.ts";
export * from "./mailer.ts";
export * from "./client-access.ts";
export * from "./client-push.ts";
export * from "./bank-info.ts";
export * from "./totp.ts";
export * from "./ml-routes.ts";
export * from "./branches.ts";
export * from "./ml-import.ts";
export * from "./ml-api.ts";
export * from "./payroll.ts";
export * from "./push.ts";
export * from "./credit.ts";
export * from "./reports.ts";
export * from "./notifications.ts";
export * from "./attendance.ts";
export * from "./fleet.ts";
export * from "./onboarding.ts";
export * from "./route-analysis.ts";
export * from "./client-api.ts";
export * from "./zkteco.ts";
export * from "./cutover.ts";
export * from "./alerts.ts";
export * from "./cleanup.ts";
export * from "./mercadopago.ts";
export * from "./ml-flex.ts";
export * from "./ml-health.ts";
export * from "./ml-sellers.ts";
export * from "./driver-employee.ts";
export * from "./wa-inbox.ts";
export * from "./ml-unlinked.ts";
export * from "./ml-courier.ts";
export * from "./facturacion.ts";
export * from "./flex-drivers.ts";
export * from "./legacy-import.ts";
export * from "./custody.ts";
export * from "./demo.ts";
export * from "./live.ts";
export * from "./offboarding.ts";
export * from "./drive-files.ts";
export * from "./tasks.ts";
export * from "./portal-invite.ts";
export * from "./gate.ts";
export * from "./attention.ts";
export * from "./buyer.ts";
