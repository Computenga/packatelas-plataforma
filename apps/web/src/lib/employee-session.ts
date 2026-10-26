import "server-only";
import { prisma } from "@packatelas/db";

/** Expediente ligado al usuario (repartidor, mecánico o empleado). */
export const employeeOf = (userId: string) => prisma.employee.findUnique({ where: { userId }, select: { id: true, name: true, employeeNo: true } });
