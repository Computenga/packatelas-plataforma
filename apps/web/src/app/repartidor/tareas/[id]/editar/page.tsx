import type { Metadata } from "next";

import { TasksEdit } from "@/components/tasks/pages";

export const metadata: Metadata = { title: "Editar tarea" };

export default function Page({ params }: PageProps<"/repartidor/tareas/[id]/editar">) {
  return <TasksEdit roles={["REPARTIDOR"]} base="/repartidor/tareas" params={params} />;
}
