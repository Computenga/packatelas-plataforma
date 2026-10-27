import { z } from "zod";
import { createManualOrder, Prisma, prisma, windowCount, type OrderStatus } from "@packatelas/db";
import { apiAuth, apiError, orderView } from "@/lib/api-v1";
import { geocodeAddress } from "@/lib/geocode-providers";

const str = (max: number) => z.string().trim().max(max).optional().nullable();
const body = z.object({
  referencia: z.string().trim().min(1).max(80).optional().nullable(),
  sucursal: str(40),
  destinatario: z.object({
    nombre: z.string().trim().min(2, "destinatario.nombre es obligatorio").max(200),
    telefono: z.string().trim().regex(/^\+?\d[\d\s-]{7,16}$/, "destinatario.telefono inválido").optional().nullable(),
  }),
  direccion: z.object({
    calle: z.string().trim().min(5, "direccion.calle es obligatoria (calle y número)").max(200),
    colonia: str(200), ciudad: str(200), estado: str(200),
    cp: z.string().trim().regex(/^\d{5}$/, "direccion.cp inválido").optional().nullable(),
    lat: z.number().min(18.85).max(20.05).optional().nullable(),
    lng: z.number().min(-99.75).max(-98.55).optional().nullable(),
    indicaciones: str(500),
  }),
  contenido: str(200),
});

const STATUSES = ["CREATED", "ASSIGNED", "OUT_FOR_DELIVERY", "DELIVERED", "FAILED", "RESCHEDULED", "RETURNING", "RETURNED_TO_WAREHOUSE", "RETURNED_TO_SELLER", "CANCELLED"];

/** Crear un envío [I08]. Con "referencia" es idempotente: repetirla devuelve el mismo envío. */
export async function POST(request: Request) {
  const { auth, error } = await apiAuth(request);
  if (error) return error;
  const json = await request.json().catch(() => undefined);
  const parsed = body.safeParse(json);
  if (!parsed.success) return apiError(422, "datos_invalidos", parsed.error.issues[0].message, { campo: parsed.error.issues[0].path.join(".") });
  const d = parsed.data;
  const clientId = auth.clientId;

  if (d.referencia) {
    const found = await prisma.order.findUnique({ where: { clientId_externalRef: { clientId, externalRef: d.referencia } } });
    if (found) return Response.json({ envio: orderView(found), creado: false });
  }
  const branches = await prisma.branch.findMany({ where: { clientId, active: true }, orderBy: { createdAt: "asc" }, select: { id: true } });
  if (d.sucursal && !branches.some((b) => b.id === d.sucursal)) return apiError(422, "sucursal_invalida", "La sucursal no existe o está inactiva", { campo: "sucursal" });

  let lat = d.direccion.lat ?? undefined, lng = d.direccion.lng ?? undefined;
  let aviso: string | undefined;
  // Ubicar direcciones tiene costo: hasta 1,500 al día por cliente; después se crea sin ubicar.
  if ((lat == null || lng == null) && (await windowCount(prisma, `geocode:${clientId}`, 1440)) > 1500) {
    aviso = "Se alcanzó el límite diario de direcciones por ubicar; manda lat y lng o Packatelas la ubicará";
  } else if (lat == null || lng == null) {
    const q = [d.direccion.calle, d.direccion.colonia, d.direccion.ciudad, d.direccion.estado, d.direccion.cp].filter(Boolean).join(", ");
    const hit = await geocodeAddress(q).catch(() => null);
    if (hit) ({ lat, lng } = hit);
    else aviso = "No se ubicó la dirección en el mapa; Packatelas la revisará antes de salir a ruta";
  }

  try {
    const order = await createManualOrder(prisma, {
      clientId,
      branchId: d.sucursal ?? branches[0]?.id,
      recipientName: d.destinatario.nombre,
      recipientPhone: d.destinatario.telefono ?? undefined,
      addressLine: d.direccion.calle,
      neighborhood: d.direccion.colonia ?? undefined,
      city: d.direccion.ciudad ?? undefined,
      state: d.direccion.estado ?? undefined,
      zip: d.direccion.cp ?? undefined,
      lat, lng,
      instructions: d.direccion.indicaciones ?? undefined,
      itemsSummary: d.contenido ?? undefined,
      externalRef: d.referencia ?? undefined,
      source: "API",
      eventSource: "CLIENT",
    });
    return Response.json({ envio: orderView(order), creado: true, ...(aviso ? { aviso } : {}) }, { status: 201 });
  } catch (e) {
    // Dos solicitudes simultáneas con la misma referencia.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002" && d.referencia) {
      const found = await prisma.order.findUnique({ where: { clientId_externalRef: { clientId, externalRef: d.referencia } } });
      if (found) return Response.json({ envio: orderView(found), creado: false });
    }
    throw e;
  }
}

/** Listar envíos del cliente: ?estado=&desde=AAAA-MM-DD&hasta=AAAA-MM-DD&pagina=1 (50 por página). */
export async function GET(request: Request) {
  const { auth, error } = await apiAuth(request);
  if (error) return error;
  const sp = new URL(request.url).searchParams;
  const estado = sp.get("estado");
  if (estado && !STATUSES.includes(estado)) return apiError(422, "estado_invalido", `estado debe ser uno de: ${STATUSES.join(", ")}`);
  const ymd = /^\d{4}-\d{2}-\d{2}$/;
  const desde = sp.get("desde"), hasta = sp.get("hasta");
  if ((desde && !ymd.test(desde)) || (hasta && !ymd.test(hasta))) return apiError(422, "fecha_invalida", "Usa fechas AAAA-MM-DD");
  const pagina = Math.max(1, Math.min(1000, Number(sp.get("pagina")) || 1));
  const where = {
    clientId: auth.clientId,
    ...(estado ? { status: estado as OrderStatus } : {}),
    ...(desde || hasta ? { createdAt: {
      ...(desde ? { gte: new Date(`${desde}T00:00:00-06:00`) } : {}),
      ...(hasta ? { lt: new Date(new Date(`${hasta}T00:00:00-06:00`).getTime() + 86400_000) } : {}),
    } } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.order.count({ where }),
    prisma.order.findMany({ where, orderBy: { createdAt: "desc" }, skip: (pagina - 1) * 50, take: 50 }),
  ]);
  return Response.json({ envios: rows.map(orderView), pagina, por_pagina: 50, total });
}
