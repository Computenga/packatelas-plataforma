import type { Metadata } from "next";

import { TasksIndex } from "@/components/tasks/pages";

export const metadata: Metadata = { title: "Tareas" };

export default function Page({ searchParams }: PageProps<"/repartidor/tareas">) {
  return <TasksIndex roles={["REPARTIDOR"]} base="/repartidor/tareas" searchParams={searchParams} />;
}
