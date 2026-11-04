import { addTaskComment, dueFrom, prisma, taskAction, toggleTaskStep, updateTask, type TaskAction, type TaskPriority } from "@packatelas/db";
import { getSessionUser } from "@/lib/session";
import { removeTaskFiles, saveTaskFiles } from "@/lib/task-upload";

const ACTIONS: TaskAction[] = ["start", "submit", "approve", "return", "cancel", "reopen"];

/** Todo lo que se hace sobre una tarea: op = comment | action | step | edit. Los permisos los revisa la capa de datos. */
export async function POST(request: Request, ctx: RouteContext<"/api/tareas/[id]">) {
  const user = await getSessionUser();
  if (!user || user.role === "CLIENTE") return Response.json({ error: "No autorizado" }, { status: 401 });
  const { id } = await ctx.params;
  const form = await request.formData().catch(() => null);
  if (!form) return Response.json({ error: "Formulario inválido" }, { status: 400 });
  const op = String(form.get("op") ?? "");
  const up = op === "comment" || op === "action" ? await saveTaskFiles(form) : { files: [] };
  if ("error" in up) return Response.json({ error: up.error }, { status: 400 });
  try {
    if (op === "comment") await addTaskComment(prisma, id, user.id, String(form.get("body") ?? ""), up.files);
    else if (op === "action") {
      const action = String(form.get("action") ?? "") as TaskAction;
      if (!ACTIONS.includes(action)) throw new Error("Acción inválida");
      await taskAction(prisma, id, user.id, action, { note: String(form.get("note") ?? ""), files: up.files });
    } else if (op === "step") await toggleTaskStep(prisma, id, user.id, String(form.get("stepId") ?? ""), form.get("done") === "1");
    else if (op === "edit") {
      const p = String(form.get("priority") ?? "");
      await updateTask(prisma, id, user.id, {
        title: String(form.get("title") ?? ""),
        description: String(form.get("description") ?? ""),
        assigneeId: String(form.get("assigneeId") ?? "") || undefined,
        priority: ["BAJA", "NORMAL", "ALTA", "URGENTE"].includes(p) ? (p as TaskPriority) : undefined,
        dueAt: dueFrom(String(form.get("dueDate") ?? ""), String(form.get("dueTime") ?? "")),
        requiresEvidence: form.get("requiresEvidence") === "on",
        requiresApproval: form.get("requiresApproval") === "on",
        checklist: String(form.get("checklist") ?? "").split("\n").map((s) => s.trim()).filter(Boolean),
      });
    } else throw new Error("Operación inválida");
    return Response.json({ ok: true });
  } catch (e) {
    await removeTaskFiles(up.files);
    return Response.json({ error: e instanceof Error ? e.message : "No se pudo guardar" }, { status: 400 });
  }
}
