import type { Metadata } from "next";
import { STAFF_ROLES } from "@/lib/roles";
import { TasksEdit } from "@/components/tasks/pages";

export const metadata: Metadata = { title: "Editar tarea" };

export default function Page({ params }: PageProps<"/admin/tareas/[id]/editar">) {
  return <TasksEdit roles={STAFF_ROLES} base="/admin/tareas" params={params} />;
}
