import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { Card, PageHeader } from "@/components/ui";
import { EmployeeForm } from "../employee-form";
import { createEmployee } from "../actions";

export const metadata: Metadata = { title: "Nuevo empleado" };

export default async function NuevoEmpleadoPage() {
  await requireUser(["ADMIN"]);
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader eyebrow="Personal" title="Nuevo empleado">Usa el mismo número con el que lo das de alta en el ZKTeco.</PageHeader>
      <Card><EmployeeForm action={createEmployee} submitLabel="Dar de alta" /></Card>
    </div>
  );
}
