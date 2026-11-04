import { notFound } from "next/navigation";
import { assignableUsers, getTaskFor, prisma, type Role } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import { ROLE_LABEL } from "@/lib/roles";
import { Card, PageHeader } from "@/components/ui";
import { TaskDetail } from "./task-detail";
import { TaskForm } from "./task-form";
import { TaskList } from "./task-list";

// Las mismas pantallas de Tareas en el portal de cada rol (cada uno con su menú).
export async function TasksIndex({ roles, base, searchParams }: { roles: Role[]; base: string; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser(roles);
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  return <TaskList userId={user.id} base={base} search={{ ver: one("ver"), estado: one("estado"), q: one("q") }} />;
}

async function people() {
  return (await assignableUsers(prisma)).map((u) => ({ id: u.id, name: u.name, detail: u.employee?.position ?? ROLE_LABEL[u.role] }));
}

export async function TasksNew({ roles, base }: { roles: Role[]; base: string }) {
  const user = await requireUser(roles);
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader eyebrow="Tareas" title="Nueva tarea" />
      <Card><TaskForm people={await people()} me={user.id} base={base} /></Card>
    </div>
  );
}

export async function TasksShow({ roles, base, params }: { roles: Role[]; base: string; params: Promise<{ id: string }> }) {
  const user = await requireUser(roles);
  return <TaskDetail id={(await params).id} userId={user.id} base={base} />;
}

const ymd = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(d);
const hm = (d: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: "America/Mexico_City", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);

export async function TasksEdit({ roles, base, params }: { roles: Role[]; base: string; params: Promise<{ id: string }> }) {
  const user = await requireUser(roles);
  const t = await getTaskFor(prisma, (await params).id, user.id);
  if (!t || !t.isCreator) notFound();
  const time = t.dueAt ? hm(t.dueAt) : "";
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader eyebrow="Editar tarea" title={t.title} />
      <Card>
        <TaskForm
          people={await people()} me={user.id} base={base} taskId={t.id}
          initial={{
            title: t.title, description: t.description ?? "", assigneeId: t.assigneeId, priority: t.priority,
            dueDate: t.dueAt ? ymd(t.dueAt) : "", dueTime: time === "23:59" ? "" : time,
            requiresEvidence: t.requiresEvidence, requiresApproval: t.requiresApproval, checklist: t.checklist.map((s) => s.text).join("\n"),
          }}
        />
      </Card>
    </div>
  );
}
