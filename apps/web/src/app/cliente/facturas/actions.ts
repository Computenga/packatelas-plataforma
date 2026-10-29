"use server";

import { revalidatePath } from "next/cache";
import { audit, prisma, requestClientInvoice } from "@packatelas/db";
import { requireClient } from "@/lib/client-scope";
import type { ActionState } from "@/components/action-form";

const RFC = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/;

export async function saveFiscalAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const { user, clientId } = await requireClient();
  const v = (k: string) => String(fd.get(k) ?? "").trim();
  const rfc = v("rfc").toUpperCase(), legalName = v("legalName"), taxRegime = v("taxRegime"), taxZip = v("taxZip"), cfdiUse = v("cfdiUse").toUpperCase(), email = v("email");
  if (!RFC.test(rfc)) return { error: "RFC inválido" };
  if (!legalName) return { error: "Escribe tu razón social como aparece en tu constancia" };
  if (!/^\d{3}$/.test(taxRegime)) return { error: "Elige tu régimen fiscal" };
  if (!/^\d{5}$/.test(taxZip)) return { error: "Código postal fiscal inválido" };
  if (!/^[A-Z]{1,2}\d{2}$/.test(cfdiUse)) return { error: "Elige el uso de CFDI" };
  if (!email.includes("@")) return { error: "Correo inválido" };
  await prisma.client.update({ where: { id: clientId }, data: { rfc, legalName, taxRegime, taxZip, cfdiUse, email } });
  await audit(prisma, { actorUserId: user.id, action: "client.fiscal_updated", entity: "Client", entityId: clientId, summary: `Datos fiscales actualizados por el cliente (${rfc})` });
  revalidatePath("/cliente/facturas");
  return { ok: "Datos fiscales guardados" };
}

export async function requestInvoiceAction(paymentId: string): Promise<ActionState> {
  const { user, clientId } = await requireClient();
  try {
    const inv = await requestClientInvoice(prisma, clientId, paymentId, user.id);
    revalidatePath("/cliente/facturas");
    return { ok: `Factura ${inv.series ?? ""}${inv.folio ?? ""} lista` };
  } catch (e) {
    revalidatePath("/cliente/facturas");
    return { error: (e instanceof Error ? e.message : "No se pudo facturar").slice(0, 300) };
  }
}
