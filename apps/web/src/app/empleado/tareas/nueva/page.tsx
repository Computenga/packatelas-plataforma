import type { Metadata } from "next";

import { TasksNew } from "@/components/tasks/pages";

export const metadata: Metadata = { title: "Nueva tarea" };

export default function Page() {
  return <TasksNew roles={["EMPLEADO"]} base="/empleado/tareas" />;
}
