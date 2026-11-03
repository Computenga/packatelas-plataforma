// Consecutivos [cmx, emx, empleado, moto]: el último número asignado en CUALQUIER lugar (hojas,
// alta manual o la plataforma). La plataforma nunca da uno menor o igual, aunque el cliente o
// empleado aún no exista en su base.
import type { Prisma, PrismaClient } from "../generated/prisma/client.ts";

type Db = PrismaClient | Prisma.TransactionClient;
export type CounterKey = "cmx" | "emx" | "empleado" | "moto";
const KEY = "consecutivos";

export async function getCounters(db: Db): Promise<Record<CounterKey, number>> {
  const v = ((await db.setting.findUnique({ where: { key: KEY } }))?.value ?? {}) as Partial<Record<CounterKey, number>>;
  return { cmx: v.cmx ?? 0, emx: v.emx ?? 0, empleado: v.empleado ?? 0, moto: v.moto ?? 0 };
}

/** Registra que `n` ya se usó (solo sube, nunca baja). */
export async function markCounter(db: Db, key: CounterKey, n: number) {
  const cur = await getCounters(db);
  if (!(n > cur[key])) return;
  const value = { ...cur, [key]: n };
  await db.setting.upsert({ where: { key: KEY }, create: { key: KEY, value }, update: { value } });
}
