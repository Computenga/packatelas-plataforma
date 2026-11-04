import { createTask, dueFrom, prisma, tasksPathFor, type TaskPriority } from "@packatelas/db";
import { getSessionUser } from "@/lib/session";
import { removeTaskFiles, saveTaskFiles } from "@/lib/task-upload";

const PRIORITIES = ["BAJA", "NORMAL", "ALTA", "URGENTE"];

/** Nueva tarea (multipart: datos + archivos). Cualquiera del equipo puede asignar. */
export async function POST(request: Request) {
  const user = await getSessionUser();
  const base = user ? tasksPathFor(user.role) : null;
  if (!user || !base) return Response.json({ error: "No autorizado" }, { status: 401 });
  const form = await request.formData().catch(() => null);
  if (!form) return Response.json({ error: "Formulario inválido" }, { status: 400 });
  const up = await saveTaskFiles(form);
  if ("error" in up) return Response.json({ error: up.error }, { status: 400 });
  const priority = String(form.get("priority") ?? "NORMAL");
  try {
    const t = await createTask(prisma, user.id, {
      title: String(form.get("title") ?? ""),
      description: String(form.get("description") ?? ""),
      assigneeId: String(form.get("assigneeId") ?? ""),
      priority: (PRIORITIES.includes(priority) ? priority : "NORMAL") as TaskPriority,
      dueAt: dueFrom(String(form.get("dueDate") ?? ""), String(form.get("dueTime") ?? "")),
      requiresEvidence: form.get("requiresEvidence") === "on",
      requiresApproval: form.get("requiresApproval") === "on",
      checklist: String(form.get("checklist") ?? "").split("\n").map((s) => s.trim()).filter(Boolean),
    }, up.files);
    return Response.json({ id: t.id, url: `${base}/${t.id}` });
  } catch (e) {
    await removeTaskFiles(up.files);
    return Response.json({ error: e instanceof Error ? e.message : "No se pudo crear" }, { status: 400 });
  }
}
