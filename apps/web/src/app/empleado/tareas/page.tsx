import type { Metadata } from "next";

import { TasksIndex } from "@/components/tasks/pages";

export const metadata: Metadata = { title: "Tareas" };

export default function Page({ searchParams }: PageProps<"/empleado/tareas">) {
  return <TasksIndex roles={["EMPLEADO"]} base="/empleado/tareas" searchParams={searchParams} />;
}
