// Día del arranque (cambio del sistema anterior a esta plataforma).
// Limpia lo que se generó en pruebas (envíos, cargos, recolecciones, ubicaciones…) y deja
// intactos clientes, sucursales, cuentas ML, usuarios, personal y flotilla. Solo se puede
// hacer UNA vez: después de marcar el arranque, la limpieza ya no está disponible.
import type { PrismaClient } from "../generated/prisma/client.ts";
import { audit } from "./orders.ts";
import { OPENING_BALANCE_TAG } from "./migration.ts";

const KEY = "arranque";
export const CUTOVER_CONFIRM = "BORRAR DATOS DE PRUEBA";
const PAYMENT_NOTE = "Anterior al arranque: ya incluido en el saldo del sistema anterior";

export type CutoverState = { at: string; by?: string; summary?: Record<string, number> } | null;

export async function getCutover(prisma: PrismaClient): Promise<CutoverState> {
  const row = await prisma.setting.findUnique({ where: { key: KEY } });
  return (row?.value as CutoverState) ?? null;
}

/** Lo que se borraría (y lo que se queda) si se arranca ahora. */
export async function cutoverPreview(prisma: PrismaClient) {
  const [orders, evidence, ledger, openings, payments, pickups, routes, pings, notices, webhooks, appNotices, mlJobs, clients, mlAccounts, users, employees, histOrders, histPayments] =
    await Promise.all([
      prisma.order.count({ where: { source: { not: "IMPORT" } } }),
      prisma.evidence.count(),
      prisma.ledgerEntry.count(),
      prisma.ledgerEntry.count({ where: { type: "ADJUSTMENT", description: OPENING_BALANCE_TAG } }),
      prisma.payment.count({ where: { source: { not: "IMPORT" }, NOT: { status: "REJECTED", note: PAYMENT_NOTE } } }),
      prisma.pickup.count(),
      prisma.route.count(),
      prisma.locationPing.count(),
      prisma.notification.count(),
      prisma.webhookDelivery.count(),
      prisma.appNotice.count(),
      prisma.mlJob.count(),
      prisma.client.count(),
      prisma.mlAccount.count(),
      prisma.user.count({ where: { active: true } }),
      prisma.employee.count(),
      prisma.order.count({ where: { source: "IMPORT" } }),
      prisma.payment.count({ where: { source: "IMPORT" } }),
    ]);
  return {
    borrar: { envios: orders, evidencias: evidence, movimientos: ledger, saldosIniciales: openings, recolecciones: pickups, rutas: routes, ubicaciones: pings, avisos: notices + appNotices, webhooks, tareasML: mlJobs },
    archivar: { pagos: payments },
    conservar: { clientes: clients, cuentasML: mlAccounts, usuarios: users, personal: employees, historialEnvios: histOrders, historialPagos: histPayments },
  };
}

/**
 * Borra los datos operativos de prueba. Los depósitos recibidos antes del arranque se conservan
 * como "rechazados" con nota (ya están en el saldo del sistema anterior; así Gmail no los vuelve a
 * aplicar). Devuelve las llaves de las fotos de evidencia para que se borren del disco.
 */
export async function resetForCutover(prisma: PrismaClient, actorUserId: string, confirm: string) {
  if (confirm.trim().toUpperCase() !== CUTOVER_CONFIRM) throw new Error(`Escribe exactamente: ${CUTOVER_CONFIRM}`);
  if (await getCutover(prisma)) throw new Error("El arranque ya se hizo; la limpieza ya no está disponible");
  const before = await cutoverPreview(prisma);
  const evidenceKeys = (await prisma.evidence.findMany({ select: { storageKey: true } })).map((e) => e.storageKey);

  await prisma.$transaction(
    async (tx) => {
      await tx.routeStop.deleteMany();
      await tx.route.deleteMany();
      await tx.ledgerEntry.deleteMany();
      // Borradores sin timbrar y facturas del modo de pruebas.
      await tx.invoice.deleteMany({ where: { OR: [{ uuid: null }, { sandbox: true }] } });
      // El historial migrado del sistema anterior (envíos y pagos de origen IMPORT) se conserva.
      await tx.payment.updateMany({ where: { source: { not: "IMPORT" } }, data: { status: "REJECTED", note: PAYMENT_NOTE } });
      await tx.evidence.deleteMany();
      await tx.order.deleteMany({ where: { source: { not: "IMPORT" } } }); // eventos y custodias de devolución en cascada
      await tx.pickup.deleteMany();
      await tx.locationPing.deleteMany();
      await tx.notification.deleteMany();
      await tx.webhookDelivery.deleteMany();
      await tx.appNotice.deleteMany();
      await tx.mlJob.deleteMany();
      await tx.storeConnector.updateMany({ data: { received: 0, created: 0, lastAt: null, lastResult: null } });
      await tx.driver.updateMany({ data: { onDuty: false, shiftStartedAt: null } });
      await tx.$executeRawUnsafe("ALTER SEQUENCE order_code_seq RESTART WITH 1");
      const summary = { ...before.borrar, pagosArchivados: before.archivar.pagos };
      await tx.setting.upsert({
        where: { key: KEY },
        update: { value: { at: new Date().toISOString(), by: actorUserId, summary } },
        create: { key: KEY, value: { at: new Date().toISOString(), by: actorUserId, summary } },
      });
      await audit(tx, {
        actorUserId,
        action: "cutover.reset",
        entity: "Setting",
        entityId: KEY,
        summary: `Arranque: se borraron ${before.borrar.envios} envíos de prueba, ${before.borrar.movimientos} movimientos y ${before.borrar.recolecciones} recolecciones; ${before.archivar.pagos} depósitos previos archivados`,
        data: summary,
      });
    },
    { timeout: 120_000 },
  );
  return { before, evidenceKeys };
}
