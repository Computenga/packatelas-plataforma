import type { Metadata } from "next";

import { TasksShow } from "@/components/tasks/pages";

export const metadata: Metadata = { title: "Tarea" };

export default function Page({ params }: PageProps<"/repartidor/tareas/[id]">) {
  return <TasksShow roles={["REPARTIDOR"]} base="/repartidor/tareas" params={params} />;
}
