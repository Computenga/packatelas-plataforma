"use server";

import { createClientUsers, importFlexLinks, importLegacyPayments, importLegacyUsers, parseFlexLinks, parseLegacyPayments, parseLegacyUsers, prisma } from "@packatelas/db";
import { requireUser } from "@/lib/auth";

export type MigState = { ok?: string; error?: string; detail?: string[] };
const text = async (fd: FormData, field: string) => {
  const f = fd.get(`${field}File`);
  if (f instanceof File && f.size > 0) {
    if (f.size > 20_000_000) throw new Error("Archivo demasiado grande (máx. 20 MB)");
    return await f.text();
  }
  return String(fd.get(field) ?? "");
};

export async function migrateUsersAction(_: MigState, fd: FormData): Promise<MigState> {
  const user = await requireUser(["ADMIN"]);
  try {
    const { rows, errors } = parseLegacyUsers(await text(fd, "users"));
    if (!rows.length) return { error: "No se leyó ningún usuario" };
    const r = await importLegacyUsers(prisma, rows, String(fd.get("tempPassword") ?? ""), user.id);
    return { ok: `${r.created.length} usuarios creados · ${r.skipped.length} ya existían · ${errors.length} renglones con error`, detail: [...r.skipped.map((s) => `ya existía: ${s}`), ...errors.map((e) => `error: ${e}`)] };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Error" };
  }
}

export async function migrateFlexAction(_: MigState, fd: FormData): Promise<MigState> {
  const user = await requireUser(["ADMIN"]);
  try {
    const rows = parseFlexLinks(await text(fd, "flex"));
    if (!rows.length) return { error: "No se leyó ningún vínculo" };
    const r = await importFlexLinks(prisma, rows, user.id);
    return { ok: `${r.linked.length} vinculados · ${r.kept.length} se quedaron como estaban · ${r.missing.length} sin repartidor`, detail: [...r.kept, ...r.missing.map((m) => `sin repartidor: ${m}`)] };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Error" };
  }
}

export async function clientUsersAction(_: MigState, fd: FormData): Promise<MigState> {
  const user = await requireUser(["ADMIN"]);
  try {
    const r = await createClientUsers(prisma, String(fd.get("tempPassword") ?? ""), user.id);
    return { ok: `${r.created.length} usuarios de clientes creados · ${r.skipped.length} omitidos`, detail: r.skipped.map((s) => `usuario ya existía: ${s}`) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Error" };
  }
}

export async function migratePaymentsAction(_: MigState, fd: FormData): Promise<MigState> {
  const user = await requireUser(["ADMIN"]);
  try {
    const { rows, errors } = parseLegacyPayments(await text(fd, "payments"));
    if (!rows.length) return { error: "No se leyó ningún pago" };
    const r = await importLegacyPayments(prisma, rows, user.id);
    return { ok: `${r.added} pagos importados · ${r.duplicates} ya estaban · ${r.unknownClients.length} clientes no encontrados · ${errors.length} renglones con error`, detail: [...r.unknownClients.map((c) => `cliente no encontrado: ${c}`), ...errors] };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Error" };
  }
}
