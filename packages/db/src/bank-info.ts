// Datos bancarios que ven las tiendas para pagar por transferencia (los captura un admin en Cobros).
import type { Prisma, PrismaClient } from "../generated/prisma/client.ts";

type Db = PrismaClient | Prisma.TransactionClient;
const KEY = "pagos.banco";
export type BankInfo = { bank: string; holder: string; clabe: string; note: string };

export async function getBankInfo(db: Db): Promise<BankInfo> {
  const v = ((await db.setting.findUnique({ where: { key: KEY } }))?.value ?? {}) as Partial<BankInfo>;
  return { bank: v.bank ?? "", holder: v.holder ?? "", clabe: v.clabe ?? "", note: v.note ?? "" };
}

export async function setBankInfo(db: Db, info: BankInfo) {
  const value = { bank: info.bank.trim(), holder: info.holder.trim(), clabe: info.clabe.replace(/\D/g, ""), note: info.note.trim() };
  await db.setting.upsert({ where: { key: KEY }, update: { value }, create: { key: KEY, value } });
}
