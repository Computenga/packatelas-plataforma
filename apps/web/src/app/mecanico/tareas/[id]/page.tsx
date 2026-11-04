import type { Metadata } from "next";

import { TasksShow } from "@/components/tasks/pages";

export const metadata: Metadata = { title: "Tarea" };

export default function Page({ params }: PageProps<"/mecanico/tareas/[id]">) {
  return <TasksShow roles={["MECANICO"]} base="/mecanico/tareas" params={params} />;
}
