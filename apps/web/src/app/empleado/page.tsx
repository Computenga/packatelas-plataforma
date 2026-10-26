import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { MyAttendance } from "@/components/my-attendance";
import { MyCharges } from "@/components/my-charges";
import { MyDocuments } from "@/components/my-documents";
import { MyPayroll } from "@/components/my-payroll";

export const metadata: Metadata = { title: "Mi asistencia" };

export default async function EmpleadoHome({ searchParams }: PageProps<"/empleado">) {
  const user = await requireUser(["EMPLEADO"]);
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-xl font-bold">Hola, {user.name.split(" ")[0]}</h1>
      <MyAttendance userId={user.id} q={(await searchParams).q} base="/empleado" />
      <MyCharges userId={user.id} />
      <MyPayroll userId={user.id} />
      <MyDocuments userId={user.id} />
    </div>
  );
}
