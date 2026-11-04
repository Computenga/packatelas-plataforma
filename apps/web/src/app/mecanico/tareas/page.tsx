import type { Metadata } from "next";

import { TasksIndex } from "@/components/tasks/pages";

export const metadata: Metadata = { title: "Tareas" };

export default function Page({ searchParams }: PageProps<"/mecanico/tareas">) {
  return <TasksIndex roles={["MECANICO"]} base="/mecanico/tareas" searchParams={searchParams} />;
}
