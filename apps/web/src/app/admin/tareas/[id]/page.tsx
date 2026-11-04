import type { Metadata } from "next";
import { STAFF_ROLES } from "@/lib/roles";
import { TasksShow } from "@/components/tasks/pages";

export const metadata: Metadata = { title: "Tarea" };

export default function Page({ params }: PageProps<"/admin/tareas/[id]">) {
  return <TasksShow roles={STAFF_ROLES} base="/admin/tareas" params={params} />;
}
