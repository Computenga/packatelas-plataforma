// Registro de pedidos: escaneo de etiquetas ML [A01], alta manual [A03] y eventos [A09].
import { Prisma, type PrismaClient, type OrderStatus, type EventSource } from "../generated/prisma/client.ts";
import { chargeOrder } from "./ledger.ts";
import { parseScan } from "./scan.ts";

type Db = PrismaClient | Prisma.TransactionClient;

const isUniqueViolation = (e: unknown) =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

export async function audit(
  db: Db,
  entry: { actorUserId?: string | null; action: string; entity: string; entityId?: string; summary: string; data?: Prisma.InputJsonValue },
) {
  return db.auditLog.create({ data: { ...entry, actorUserId: entry.actorUserId ?? undefined } });
}

/** Agrega un evento al pedido y, si trae estado nuevo, actualiza el estado actual. */
export async function addOrderEvent(
  db: Db,
  input: {
    orderId: string;
    type: string;
    source: EventSource;
    toStatus?: OrderStatus;
    actorUserId?: string | null;
    note?: string;
    lat?: number;
    lng?: number;
    data?: Prisma.InputJsonValue;
    occurredAt?: Date;
    clientEventId?: string;
  },
) {
  const order = await db.order.findUniqueOrThrow({ where: { id: input.orderId }, select: { status: true } });
  const event = await db.orderEvent.create({
    data: {
      orderId: input.orderId,
      type: input.type,
      source: input.source,
      fromStatus: input.toStatus ? order.status : undefined,
      toStatus: input.toStatus,
      actorUserId: input.actorUserId ?? undefined,
      note: input.note,
      lat: input.lat,
      lng: input.lng,
      data: input.data,
      occurredAt: input.occurredAt ?? new Date(),
      clientEventId: input.clientEventId,
    },
  });
  if (input.toStatus && input.toStatus !== order.status) {
    await db.order.update({
      where: { id: input.orderId },
      data: {
        status: input.toStatus,
        ...(input.toStatus === "DELIVERED" ? { deliveredAt: input.occurredAt ?? new Date() } : {}),
      },
    });
  }
  return event;
}

export type ScanOutcome =
  | { status: "created"; orderId: string; code: string; clientName: string; charged: boolean }
  | { status: "existing"; orderId: string; code: string; clientName: string }
  | { status: "unknown_account"; shipmentId: string; senderId: string | null; message: string }
  | { status: "invalid"; message: string };

/**
 * Registra el escaneo de una etiqueta. Idempotente: el mismo envío escaneado varias veces
 * (o desde dos equipos a la vez) crea un solo pedido y un solo cargo [F02].
 */
export async function registerScan(
  prisma: PrismaClient,
  input: { raw: string; actorUserId?: string; source?: EventSource },
): Promise<ScanOutcome> {
  const parsed = parseScan(input.raw);
  const source = input.source ?? "SCAN";

  if (parsed.kind === "INVALID") return { status: "invalid", message: parsed.reason };

  if (parsed.kind === "CODE") {
    const order = await prisma.order.findUnique({ where: { code: parsed.code }, include: { client: true } });
    if (!order) return { status: "invalid", message: `No existe el pedido ${parsed.code}` };
    await addOrderEvent(prisma, { orderId: order.id, type: "scanned", source, actorUserId: input.actorUserId });
    return { status: "existing", orderId: order.id, code: order.code, clientName: order.client.name };
  }

  const existing = await prisma.order.findUnique({
    where: { mlShipmentId: parsed.shipmentId },
    include: { client: true },
  });
  if (existing) {
    await addOrderEvent(prisma, { orderId: existing.id, type: "scanned", source, actorUserId: input.actorUserId });
    return { status: "existing", orderId: existing.id, code: existing.code, clientName: existing.client.name };
  }

  const account = parsed.senderId
    ? await prisma.mlAccount.findUnique({
        where: { mlUserId: parsed.senderId },
        include: { client: true, routes: { orderBy: { isDefault: "desc" } } },
      })
    : null;
  if (!account) {
    return {
      status: "unknown_account",
      shipmentId: parsed.shipmentId.toString(),
      senderId: parsed.senderId?.toString() ?? null,
      message: parsed.senderId
        ? `La cuenta ML ${parsed.senderId} no está ligada a ningún cliente`
        : "La lectura no trae la cuenta del vendedor; escanea el QR de la etiqueta",
    };
  }

  const code = `ML-${parsed.shipmentId}`;
  try {
    const result = await prisma.$transaction(async (tx) => {
      const order = await tx.order.create({
        data: {
          code,
          source: "ML_FLEX",
          clientId: account.clientId,
          branchId: account.routes[0]?.branchId,
          mlAccountId: account.id,
          mlShipmentId: parsed.shipmentId,
          addressLine: "Pendiente de sincronizar con MercadoLibre",
        },
      });
      await addOrderEvent(tx, {
        orderId: order.id,
        type: "created",
        source,
        toStatus: "CREATED",
        actorUserId: input.actorUserId,
        data: { mlAccount: account.nickname },
      });
      const charge = await chargeOrder(tx, order.id, input.actorUserId);
      return { order, charged: !!charge };
    });
    return { status: "created", orderId: result.order.id, code, clientName: account.client.name, charged: result.charged };
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    // Otro equipo lo creó en el mismo instante.
    const order = await prisma.order.findUniqueOrThrow({ where: { code }, include: { client: true } });
    return { status: "existing", orderId: order.id, code: order.code, clientName: order.client.name };
  }
}

export type ManualOrderInput = {
  clientId: string;
  branchId?: string;
  recipientName: string;
  recipientPhone?: string;
  addressLine: string;
  neighborhood?: string;
  city?: string;
  state?: string;
  zip?: string;
  lat?: number;
  lng?: number;
  instructions?: string;
  itemsSummary?: string;
  source?: "MANUAL" | "IMPORT" | "EXTERNAL_SCAN";
  /** Quién lo dio de alta (para el historial): administración o la propia tienda [C04]. */
  eventSource?: "ADMIN" | "CLIENT" | "IMPORT";
};

async function insertManualOrder(tx: Prisma.TransactionClient, input: ManualOrderInput, actorUserId?: string) {
  const [{ n }] = await tx.$queryRaw<{ n: bigint }[]>`SELECT nextval('order_code_seq') AS n`;
  const code = `PK-${n.toString().padStart(6, "0")}`;
  const { source = "MANUAL", eventSource, ...data } = input;
  const order = await tx.order.create({ data: { ...data, code, source } });
  await addOrderEvent(tx, {
    orderId: order.id,
    type: "created",
    source: eventSource ?? (source === "IMPORT" ? "IMPORT" : "ADMIN"),
    toStatus: "CREATED",
    actorUserId,
  });
  await chargeOrder(tx, order.id, actorUserId);
  return order;
}

/** Alta manual de un pedido con código propio PK-000001 [A03]. También genera su cargo. */
export async function createManualOrder(prisma: PrismaClient, input: ManualOrderInput, actorUserId?: string) {
  return prisma.$transaction((tx) => insertManualOrder(tx, input, actorUserId));
}

export const IMPORT_MAX_ROWS = 500;

/**
 * Carga masiva [A03]: todo o nada, en una sola transacción. `batchId` evita que un doble clic
 * (o reenviar el formulario) cree los pedidos dos veces.
 */
export async function importOrders(
  prisma: PrismaClient,
  input: { batchId: string; clientId: string; branchId?: string; byClient?: boolean; rows: Omit<ManualOrderInput, "clientId" | "branchId" | "source" | "eventSource">[] },
  actorUserId?: string,
): Promise<{ status: "created" | "already"; codes: string[] }> {
  if (!input.rows.length) throw new Error("No hay renglones para cargar");
  if (input.rows.length > IMPORT_MAX_ROWS) throw new Error(`Máximo ${IMPORT_MAX_ROWS} pedidos por carga`);
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"import:" + input.batchId}))`;
      const prev = await tx.auditLog.findFirst({ where: { action: "orders.imported", entityId: input.batchId } });
      if (prev) {
        const data = prev.data as { codes?: string[]; clientId?: string } | null;
        if (data?.clientId !== input.clientId) throw new Error("Lote inválido");
        return { status: "already" as const, codes: data?.codes ?? [] };
      }
      const codes: string[] = [];
      for (const row of input.rows) {
        const o = await insertManualOrder(
          tx,
          { ...row, clientId: input.clientId, branchId: input.branchId, source: "IMPORT", eventSource: input.byClient ? "CLIENT" : "IMPORT" },
          actorUserId,
        );
        codes.push(o.code);
      }
      await audit(tx, {
        actorUserId,
        action: "orders.imported",
        entity: "ImportBatch",
        entityId: input.batchId,
        summary: `Carga masiva de ${codes.length} pedido(s) (${codes[0]} a ${codes[codes.length - 1]})`,
        data: { clientId: input.clientId, codes },
      });
      return { status: "created" as const, codes };
    },
    { timeout: 60_000, maxWait: 10_000 },
  );
}
