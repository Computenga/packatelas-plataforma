import type { Metadata } from "next";
import { prisma } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import { ActionForm } from "@/components/action-form";
import { Card, Field, PageHeader } from "@/components/ui";
import { createLeadAction } from "../actions";
import { LeadFields } from "../lead-fields";

export const metadata: Metadata = { title: "Nuevo prospecto" };

export default async function NuevoLeadPage() {
  const me = await requireUser(["ADMIN"]);
  const owners = await prisma.user.findMany({ where: { role: { in: ["ADMIN", "OPERADOR", "DESPACHADOR"] }, active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader eyebrow="CRM" title="Nuevo prospecto">
        Alguien que preguntó por WhatsApp, una recomendación, una visita… Si ya existe con el mismo teléfono o correo, se abre ese.
      </PageHeader>
      <Card>
        <ActionForm action={createLeadAction} submitLabel="Guardar prospecto">
          <LeadFields lead={{ ownerId: me.id }} owners={owners} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Qué sigue" name="nextAction" defaultValue="Primer contacto" />
            <Field label="Para cuándo" name="nextActionAt" type="date" />
          </div>
        </ActionForm>
      </Card>
    </div>
  );
}
