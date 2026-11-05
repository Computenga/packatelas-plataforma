"use server";

import { cookies, headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { buyerNote, buyerProblem, buyerReschedule, buyerVerify, prisma } from "@packatelas/db";
import { buyerCookieName, buyerCookieValue, buyerVerified, orderIdFromToken } from "@/lib/tracking";
import { ipFrom } from "@/lib/request-ip";

export type BuyerState = { ok?: string; error?: string };

async function verifiedOrder(token: string) {
  const id = orderIdFromToken(token);
  if (!id) throw new Error("Enlace inválido");
  if (!buyerVerified(id, (await cookies()).get(buyerCookieName(id))?.value)) throw new Error("Confirma primero los últimos 4 dígitos de tu teléfono");
  return id;
}

const run = async (token: string, fn: (id: string) => Promise<string>): Promise<BuyerState> => {
  try {
    const ok = await fn(await verifiedOrder(token));
    revalidatePath(`/s/${token}`);
    return { ok };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "No se pudo guardar" };
  }
};

export async function verifyAction(token: string, _: BuyerState, fd: FormData): Promise<BuyerState> {
  const id = orderIdFromToken(token);
  if (!id) return { error: "Enlace inválido" };
  const r = await buyerVerify(prisma, id, String(fd.get("last4") ?? ""), ipFrom(await headers()));
  if (!r.ok) return { error: r.error };
  const c = buyerCookieValue(id);
  (await cookies()).set(buyerCookieName(id), c.value, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: c.maxAge, path: `/s/` });
  revalidatePath(`/s/${token}`);
  return { ok: "Listo" };
}

export async function rescheduleAction(token: string, _: BuyerState, fd: FormData) {
  return run(token, async (id) => `Listo: lo entregamos el ${await buyerReschedule(prisma, id, String(fd.get("ymd") ?? ""))}.`);
}

export async function noteAction(token: string, _: BuyerState, fd: FormData) {
  return run(token, async (id) => {
    await buyerNote(prisma, id, { text: String(fd.get("text") ?? ""), receiver: String(fd.get("receiver") ?? "") });
    return "Listo: el repartidor verá tus indicaciones.";
  });
}

export async function problemAction(token: string, _: BuyerState, fd: FormData) {
  return run(token, async (id) => {
    await buyerProblem(prisma, id, String(fd.get("kind") ?? ""), String(fd.get("text") ?? ""));
    return "Recibimos tu reporte. Lo revisamos con la tienda y te contactamos.";
  });
}
