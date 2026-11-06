"use server";

import { revalidatePath } from "next/cache";
import { keepAutoEmployee, mergeDriverDuplicate, prisma } from "@packatelas/db";
import { requireUser } from "@/lib/auth";

export async function mergeDriverAction(autoId: string, employeeId: string, keepUserId: string) {
  const admin = await requireUser(["ADMIN"]);
  await mergeDriverDuplicate(prisma, { autoId, employeeId, keepUserId }, admin.id);
  revalidatePath("/admin/personal");
  revalidatePath("/admin/repartidores");
}

export async function keepAutoAction(autoId: string) {
  const admin = await requireUser(["ADMIN"]);
  await keepAutoEmployee(prisma, autoId, admin.id);
  revalidatePath("/admin/personal");
}
