"use server";

import { revalidatePath } from "next/cache";
import { cancelInvoice, invoicePayment, issueInvoice, prisma, saveInvoiceSettings } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import type { ActionState } from "@/components/action-form";

const PATH = "/admin/cobros/facturacion";
const msg = (e: unknown) => (e instanceof Error ? e.message : "Error").slice(0, 400);

export async function saveFacturacionAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser(["ADMIN"]);
  const serie = String(fd.get("serie") ?? "");
  const [serieId, serieName] = serie ? [Number(serie.split("|")[0]), serie.split("|")[1] ?? null] : [null, null];
  try {
    await saveInvoiceSettings(prisma, {
      autoEnabled: fd.get("autoEnabled") === "on",
      serieId: serieId || null,
      serieName,
      claveProdServ: String(fd.get("claveProdServ") ?? "").trim(),
      claveUnidad: String(fd.get("claveUnidad") ?? "").trim().toUpperCase(),
      unidad: String(fd.get("unidad") ?? "").trim(),
      descripcion: String(fd.get("descripcion") ?? "").trim(),
      preciosConIva: fd.get("preciosConIva") === "on",
      formaPagoTarjeta: String(fd.get("formaPagoTarjeta") ?? "04"),
      enviarCorreo: fd.get("enviarCorreo") === "on",
      diasSolicitud: Math.min(90, Math.max(1, Number(fd.get("diasSolicitud")) || 30)),
    }, user.id);
  } catch (e) {
    return { error: msg(e) };
  }
  revalidatePath(PATH);
  return { ok: "Guardado" };
}

export async function invoicePaymentAction(paymentId: string): Promise<ActionState> {
  const user = await requireUser(["ADMIN"]);
  try {
    const inv = await invoicePayment(prisma, paymentId, { requestedBy: "admin", actorUserId: user.id });
    revalidatePath(PATH);
    return { ok: `Factura ${inv.series ?? ""}${inv.folio ?? ""} timbrada` };
  } catch (e) {
    revalidatePath(PATH);
    return { error: msg(e) };
  }
}

export async function retryInvoiceAction(invoiceId: string): Promise<ActionState> {
  const user = await requireUser(["ADMIN"]);
  try {
    await prisma.invoice.update({ where: { id: invoiceId, status: "FAILED" }, data: { status: "PENDING" } });
    await issueInvoice(prisma, invoiceId, { actorUserId: user.id });
    revalidatePath(PATH);
    return { ok: "Timbrada" };
  } catch (e) {
    revalidatePath(PATH);
    return { error: msg(e) };
  }
}

export async function cancelInvoiceAction(invoiceId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser(["ADMIN"]);
  const motivo = fd.get("motivo") === "03" ? "03" : "02";
  if (fd.get("confirm") !== "CANCELAR") return { error: "Escribe CANCELAR para confirmar" };
  try {
    await cancelInvoice(prisma, invoiceId, motivo, user.id);
    revalidatePath(PATH);
    return { ok: "Cancelada ante el SAT" };
  } catch (e) {
    return { error: msg(e) };
  }
}
