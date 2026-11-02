"use server";

import { prisma } from "@packatelas/db";
import { requireUser } from "@/lib/auth";

/** El recorrido no vuelve a abrirse solo. */
export async function tourSeen() {
  const user = await requireUser(["CLIENTE"]);
  await prisma.user.update({ where: { id: user.id }, data: { tourSeenAt: new Date() } });
}
