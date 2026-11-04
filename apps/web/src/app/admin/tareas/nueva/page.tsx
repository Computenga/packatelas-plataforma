import type { Metadata } from "next";
import { STAFF_ROLES } from "@/lib/roles";
import { TasksNew } from "@/components/tasks/pages";

export const metadata: Metadata = { title: "Nueva tarea" };

export default function Page() {
  return <TasksNew roles={STAFF_ROLES} base="/admin/tareas" />;
}
