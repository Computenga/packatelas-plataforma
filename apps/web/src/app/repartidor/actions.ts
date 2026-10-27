"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { addOrderEvent, createManualOrder, parseScan, prisma, registerScan, setShift, windowCount } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import type { ActionState } from "@/components/action-form";

async function requireDriver() {
  const user = await requireUser(["REPARTIDOR"]);
  const driver = await prisma.driver.findUnique({ where: { userId: user.id } });
  if (!driver || !driver.active) redirect("/repartidor");
  return { user, driver };
}

export async function toggleShift() {
  const { user, driver } = await requireDriver();
  await setShift(prisma, driver.id, !driver.onDuty, user.id);
  revalidatePath("/repartidor");
}

export type DriverScanResult =
  | { status: "found"; orderId: string; code: string; mine: boolean; free: boolean; orderStatus: string }
  | { status: "external"; raw: string }
  | { status: "error"; message: string };

/** Identifica la etiqueta escaneada por el repartidor [R03, R14]. */
export async function driverScan(raw: string): Promise<DriverScanResult> {
  const { user, driver } = await requireDriver();
  if (typeof raw !== "string" || raw.length > 2000) return { status: "error", message: "Lectura inválida" };
  const parsed = parseScan(raw);

  if (parsed.kind === "INVALID") return { status: "external", raw: raw.trim().slice(0, 120) };

  const where = parsed.kind === "CODE" ? { code: parsed.code } : { mlShipmentId: parsed.shipmentId };
  let order = await prisma.order.findUnique({ where });

  if (!order && parsed.kind === "ML") {
    // Paquete ML aún no registrado: se crea con el cargo del cliente, como en bodega.
    const r = await registerScan(prisma, { raw, actorUserId: user.id, source: "DRIVER_APP" });
    if (r.status === "created" || r.status === "existing") order = await prisma.order.findUnique({ where: { id: r.orderId } });
    else if (r.status === "unknown_account") return { status: "error", message: `${r.message}. Entrégalo en bodega o avisa al despachador.` };
  }
  if (!order) return { status: "error", message: "No se encontró el pedido" };
  // Freno contra buscar pedidos ajenos tecleando códigos (consecutivos): máximo 80 por hora.
  if (order.driverId !== driver.id && (await windowCount(prisma, `driver-lookup:${driver.id}`, 60)) > 80) {
    return { status: "error", message: "Demasiadas búsquedas de pedidos ajenos; avisa al despachador" };
  }

  return {
    status: "found",
    orderId: order.id,
    code: order.code,
    mine: order.driverId === driver.id,
    free: order.driverId == null,
    orderStatus: order.status,
  };
}

const externalSchema = z.object({
  clientId: z.string().min(1, "Elige el cliente"),
  ref: z.string().trim().max(120).optional(),
  recipientName: z.string().trim().min(2, "Escribe quién recibe"),
  recipientPhone: z.string().trim().max(20).optional(),
  addressLine: z.string().trim().min(5, "Escribe la dirección"),
  neighborhood: z.string().trim().optional(),
  city: z.string().trim().optional(),
  state: z.string().trim().optional(),
  zip: z.string().trim().regex(/^(\d{5})?$/, "C.P. inválido").optional(),
  lat: z.union([z.coerce.number().min(14).max(33), z.literal("")]).optional(),
  lng: z.union([z.coerce.number().min(-118).max(-86), z.literal("")]).optional(),
});

/** Alta de un paquete externo escaneado por el repartidor; queda en su ruta [R14]. */
export async function createExternal(_: ActionState, fd: FormData): Promise<ActionState> {
  const { user, driver } = await requireDriver();
  const parsed = externalSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;
  const client = await prisma.client.findUnique({ where: { id: d.clientId } });
  if (!client?.active) return { error: "Cliente no encontrado" };
  // Cada alta genera un cargo al cliente: máximo 40 al día por repartidor (queda en el historial de cada envío).
  if ((await windowCount(prisma, `driver-external:${driver.id}`, 1440)) > 40) return { error: "Llegaste al máximo de paquetes externos del día; avisa al despachador" };

  const order = await createManualOrder(
    prisma,
    {
      clientId: client.id,
      source: "EXTERNAL_SCAN",
      recipientName: d.recipientName,
      recipientPhone: d.recipientPhone || undefined,
      addressLine: d.addressLine,
      neighborhood: d.neighborhood || undefined,
      city: d.city || undefined,
      state: d.state || undefined,
      zip: d.zip || undefined,
      lat: d.lat === "" ? undefined : d.lat,
      lng: d.lng === "" ? undefined : d.lng,
      instructions: d.ref ? `Etiqueta externa: ${d.ref}` : undefined,
    },
    user.id,
  );
  await prisma.order.update({ where: { id: order.id }, data: { driverId: driver.id } });
  await addOrderEvent(prisma, { orderId: order.id, type: "scanned_loaded", source: "DRIVER_APP", toStatus: "OUT_FOR_DELIVERY", actorUserId: user.id, note: "Paquete externo dado de alta por el repartidor" });
  redirect("/repartidor");
}
