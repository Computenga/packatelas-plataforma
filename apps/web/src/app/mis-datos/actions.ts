"use server";

import { revalidatePath } from "next/cache";
import { audit, prisma } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import type { ActionState } from "@/components/action-form";

const t = (fd: FormData, k: string, max: number) => String(fd.get(k) ?? "").trim().replace(/\s+/g, " ").slice(0, max);

/** El repartidor o empleado llena los datos de su propio expediente. */
export async function saveMyDataAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser(["REPARTIDOR", "EMPLEADO", "MECANICO", "RECEPCION", "OPERADOR", "DESPACHADOR"]);
  const emp = await prisma.employee.findUnique({ where: { userId: user.id }, select: { id: true, employeeNo: true } });
  if (!emp) return { error: "Tu usuario aún no está ligado a tu expediente; avisa a oficina" };
  const curp = t(fd, "curp", 18).toUpperCase();
  const rfc = t(fd, "rfc", 13).toUpperCase();
  const nss = t(fd, "nss", 11).replace(/\D/g, "");
  const phone = t(fd, "phone", 20).replace(/\D/g, "").slice(-10);
  const clabe = t(fd, "clabe", 18).replace(/\D/g, "");
  const ePhone = t(fd, "emergencyPhone", 20).replace(/\D/g, "").slice(-10);
  if (curp && !/^[A-Z][AEIOUX][A-Z]{2}\d{6}[HM][A-Z]{5}[A-Z0-9]\d$/.test(curp)) return { error: "La CURP no tiene el formato correcto (18 caracteres)" };
  if (rfc && !/^[A-ZÑ&]{4}\d{6}[A-Z0-9]{3}$/.test(rfc)) return { error: "El RFC con homoclave tiene 13 caracteres" };
  if (nss && nss.length !== 11) return { error: "El NSS tiene 11 dígitos" };
  if (phone && phone.length !== 10) return { error: "Escribe tu celular a 10 dígitos" };
  if (clabe && clabe.length !== 18) return { error: "La CLABE tiene 18 dígitos" };
  if (ePhone && ePhone.length !== 10) return { error: "El teléfono de emergencia va a 10 dígitos" };
  const eName = t(fd, "emergencyName", 100), eRel = t(fd, "emergencyRelation", 40);
  await prisma.employee.update({
    where: { id: emp.id },
    data: {
      curp: curp || null, rfc: rfc || null, nss: nss || null, phone: phone || null, email: t(fd, "email", 120).toLowerCase() || null,
      address: t(fd, "address", 300) || null, bank: t(fd, "bank", 40) || null, clabe: clabe || null,
      emergency: eName || ePhone ? { name: eName, phone: ePhone, relation: eRel } : undefined,
    },
  });
  if (phone && user.role === "REPARTIDOR") await prisma.driver.updateMany({ where: { userId: user.id }, data: { phone } });
  await audit(prisma, { actorUserId: user.id, action: "employee.self_data", entity: "Employee", entityId: emp.id, summary: `#${emp.employeeNo} actualizó sus datos de expediente` });
  revalidatePath("/repartidor");
  revalidatePath("/repartidor/perfil");
  revalidatePath("/empleado");
  return { ok: "Datos guardados. ¡Gracias!" };
}
