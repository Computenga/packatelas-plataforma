import "server-only";
import { prisma } from "@packatelas/db";
import { EMPRESA_DEFAULT, type Empresa } from "./rh-text";

const KEY = "rh.empresa";
export async function getEmpresa(): Promise<Empresa> {
  const row = await prisma.setting.findUnique({ where: { key: KEY } });
  return { ...EMPRESA_DEFAULT, ...((row?.value as Partial<Empresa>) ?? {}) };
}
export async function saveEmpresa(e: Partial<Empresa>) {
  const clean = Object.fromEntries(Object.entries(e).filter(([k, v]) => k in EMPRESA_DEFAULT && typeof v === "string").map(([k, v]) => [k, (v as string).slice(0, 300)]));
  await prisma.setting.upsert({ where: { key: KEY }, update: { value: clean }, create: { key: KEY, value: clean } });
}
