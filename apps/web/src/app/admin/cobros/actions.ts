"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { addAdjustment, applyUnidentifiedPayment, prisma, registerManualPayment, setPickupExemption } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import type { ActionState } from "@/components/action-form";

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida");

export async function paymentAction(clientId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser(["ADMIN"]);
  const parsed = z
    .object({
      amount: z.coerce.number().positive("El monto debe ser mayor a 0").max(1_000_000),
      date: ymd,
      method: z.enum(["TRANSFER", "CASH", "OTHER"]),
      reference: z.string().trim().max(100).optional(),
      note: z.string().trim().max(300).optional(),
    })
    .safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;
  await registerManualPayment(
    prisma,
    { clientId, amount: d.amount, receivedAt: new Date(`${d.date}T12:00:00-06:00`), method: d.method, reference: d.reference || undefined, note: d.note || undefined },
    user.id,
  );
  revalidatePath(`/admin/cobros/${clientId}`);
  return { ok: `Abono de $${d.amount.toFixed(2)} registrado` };
}

export async function adjustmentAction(clientId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser(["ADMIN"]);
  const parsed = z
    .object({
      amount: z.coerce.number().refine((n) => n !== 0, "El monto no puede ser 0"),
      kind: z.enum(["charge", "credit"]),
      description: z.string().trim().min(3, "Escribe el motivo"),
    })
    .safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { amount, kind, description } = parsed.data;
  await addAdjustment(prisma, clientId, kind === "credit" ? -Math.abs(amount) : Math.abs(amount), description, user.id);
  revalidatePath(`/admin/cobros/${clientId}`);
  return { ok: "Ajuste registrado" };
}

export async function exemptionAction(clientId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser(["ADMIN"]);
  const until = String(fd.get("until") ?? "");
  if (fd.get("remove") === "1") {
    await setPickupExemption(prisma, clientId, null, undefined, user.id);
    revalidatePath(`/admin/cobros/${clientId}`);
    return { ok: "Exención retirada" };
  }
  if (!ymd.safeParse(until).success) return { error: "Elige hasta qué fecha" };
  const date = new Date(`${until}T23:59:59-06:00`);
  if (date < new Date()) return { error: "La fecha debe ser futura" };
  await setPickupExemption(prisma, clientId, date, String(fd.get("note") ?? "").trim() || undefined, user.id);
  revalidatePath(`/admin/cobros/${clientId}`);
  return { ok: `Exento hasta ${until}` };
}

export async function applyPaymentAction(paymentId: string, fd: FormData) {
  const user = await requireUser(["ADMIN"]);
  const clientId = String(fd.get("clientId") ?? "");
  if (!clientId) return;
  try {
    await applyUnidentifiedPayment(prisma, paymentId, clientId, user.id);
  } catch {
    // ya aplicado por otra persona: la página se refresca y lo muestra
  }
  revalidatePath("/admin/cobros");
}
