import type { Metadata } from "next";

import { TasksEdit } from "@/components/tasks/pages";

export const metadata: Metadata = { title: "Editar tarea" };

export default function Page({ params }: PageProps<"/empleado/tareas/[id]/editar">) {
  return <TasksEdit roles={["EMPLEADO"]} base="/empleado/tareas" params={params} />;
}
