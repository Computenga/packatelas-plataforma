import type { Metadata } from "next";
import { STAFF_ROLES } from "@/lib/roles";
import { TasksIndex } from "@/components/tasks/pages";

export const metadata: Metadata = { title: "Tareas" };

export default function Page({ searchParams }: PageProps<"/admin/tareas">) {
  return <TasksIndex roles={STAFF_ROLES} base="/admin/tareas" searchParams={searchParams} />;
}
