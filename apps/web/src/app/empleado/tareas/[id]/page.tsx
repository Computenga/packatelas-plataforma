import type { Metadata } from "next";

import { TasksShow } from "@/components/tasks/pages";

export const metadata: Metadata = { title: "Tarea" };

export default function Page({ params }: PageProps<"/empleado/tareas/[id]">) {
  return <TasksShow roles={["EMPLEADO"]} base="/empleado/tareas" params={params} />;
}
