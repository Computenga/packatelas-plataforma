import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { MyAttendance } from "@/components/my-attendance";

export const metadata: Metadata = { title: "Mi asistencia" };

export default async function AsistenciaRepartidorPage({ searchParams }: PageProps<"/repartidor/asistencia">) {
  const user = await requireUser(["REPARTIDOR"]);
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold">Mi asistencia</h1>
      <MyAttendance userId={user.id} q={(await searchParams).q} base="/repartidor/asistencia" />
    </div>
  );
}
