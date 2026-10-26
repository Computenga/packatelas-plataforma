// Validación del alta manual de un pedido [A03, C04]; la usan el admin y el portal del cliente.
import { z } from "zod";
import type { ManualOrderInput } from "@packatelas/db";

const coord = (min: number, max: number) => z.union([z.coerce.number().min(min).max(max), z.literal("")]).optional();

export const orderFields = z.object({
  branchId: z.string().optional(),
  recipientName: z.string().trim().min(2, "Escribe el nombre de quien recibe").max(200),
  recipientPhone: z.string().trim().regex(/^(\+?\d[\d\s-]{7,16})?$/, "Teléfono inválido").optional(),
  addressLine: z.string().trim().min(5, "Escribe la calle y número").max(200),
  neighborhood: z.string().trim().max(200).optional(),
  city: z.string().trim().max(200).optional(),
  state: z.string().trim().max(200).optional(),
  zip: z.string().trim().regex(/^(\d{5})?$/, "Código postal inválido").optional(),
  lat: coord(14, 33),
  lng: coord(-118, -86),
  instructions: z.string().trim().max(500).optional(),
  itemsSummary: z.string().trim().max(200).optional(),
});

const blank = (v?: string) => (v ? v : undefined);

export function toManualInput(d: z.infer<typeof orderFields>, clientId: string, branchId?: string): ManualOrderInput {
  return {
    clientId,
    branchId,
    recipientName: d.recipientName,
    recipientPhone: blank(d.recipientPhone),
    addressLine: d.addressLine,
    neighborhood: blank(d.neighborhood),
    city: blank(d.city),
    state: blank(d.state),
    zip: blank(d.zip),
    lat: d.lat === "" ? undefined : d.lat,
    lng: d.lng === "" ? undefined : d.lng,
    instructions: blank(d.instructions),
    itemsSummary: blank(d.itemsSummary),
  };
}
