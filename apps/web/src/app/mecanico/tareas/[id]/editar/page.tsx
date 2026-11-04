import type { Metadata } from "next";

import { TasksEdit } from "@/components/tasks/pages";

export const metadata: Metadata = { title: "Editar tarea" };

export default function Page({ params }: PageProps<"/mecanico/tareas/[id]/editar">) {
  return <TasksEdit roles={["MECANICO"]} base="/mecanico/tareas" params={params} />;
}
