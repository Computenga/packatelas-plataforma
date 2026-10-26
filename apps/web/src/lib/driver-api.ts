import "server-only";
import { prisma } from "@packatelas/db";
import { getSessionUser } from "./session";

/** Sesión de repartidor para las rutas de API de la app; null si no aplica. */
export async function getDriverSession() {
  const user = await getSessionUser();
  if (!user || user.role !== "REPARTIDOR") return null;
  const driver = await prisma.driver.findUnique({ where: { userId: user.id } });
  if (!driver || !driver.active) return null;
  return { user, driver };
}

export const unauthorized = () => Response.json({ error: "No autorizado" }, { status: 401 });
