import { notFound } from "next/navigation";
import { prisma } from "@packatelas/db";

export async function loadGateDriver(driverId: string) {
  const d = await prisma.driver.findUnique({
    where: { id: driverId },
    select: { id: true, active: true, photoKey: true, user: { select: { name: true, active: true, employee: { select: { employeeNo: true, status: true } } } } },
  });
  if (!d) notFound();
  return {
    id: d.id, name: d.user.name, employeeNo: d.user.employee?.employeeNo ?? null, hasPhoto: !!d.photoKey,
    active: d.active && d.user.active && d.user.employee?.status !== "BAJA",
  };
}
