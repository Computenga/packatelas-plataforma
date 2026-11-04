"use server";

import { revalidatePath } from "next/cache";
import { cancelReturnOrder, createReturnOrder, prisma, returnCandidate, searchReturnCandidates, type CandidateResult, type ReturnCandidate } from "@packatelas/db";
import { requireUser } from "@/lib/auth";

const ROLES = ["ADMIN", "OPERADOR", "DESPACHADOR"] as const;

export async function candidateAction(input: { raw?: string; orderId?: string }): Promise<CandidateResult> {
  await requireUser([...ROLES]);
  if ((input.raw?.length ?? 0) > 2000) return { ok: false, error: "Lectura inválida" };
  return returnCandidate(prisma, input);
}

export async function searchAction(q: string, clientId?: string): Promise<ReturnCandidate[]> {
  await requireUser([...ROLES]);
  return searchReturnCandidates(prisma, q, clientId);
}

export async function branchesAction(clientId: string) {
  await requireUser([...ROLES]);
  return prisma.branch.findMany({ where: { clientId, active: true }, select: { id: true, name: true, address: true }, orderBy: { createdAt: "asc" } });
}

export async function createReturnAction(orderIds: string[], branchId: string | undefined, note: string): Promise<{ error?: string; id?: string; code?: string }> {
  const user = await requireUser([...ROLES]);
  try {
    const dv = await createReturnOrder(prisma, { orderIds, branchId: branchId || undefined, note }, user.id);
    revalidatePath("/admin/devoluciones");
    return { id: dv.id, code: dv.code };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "No se pudo crear" };
  }
}

export async function cancelReturnAction(id: string, fd: FormData) {
  const user = await requireUser([...ROLES]);
  await cancelReturnOrder(prisma, id, String(fd.get("reason") ?? ""), user.id);
  revalidatePath("/admin/devoluciones");
  revalidatePath(`/admin/pedidos/${id}`);
}
