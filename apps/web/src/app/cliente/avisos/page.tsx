import type { Metadata } from "next";
import { clientPushPrefs, prisma, CLIENT_PUSH_EVENTS } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import { ActionForm } from "@/components/action-form";
import { Card } from "@/components/ui";
import { savePrefs } from "./actions";

export const metadata: Metadata = { title: "Mis avisos" };

/** La tienda elige qué notificaciones push recibe (gratis, en el celular o la computadora). */
export default async function AvisosClientePage() {
  const user = await requireUser(["CLIENTE"]);
  const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { notifyPrefs: true } });
  const prefs = clientPushPrefs(row.notifyPrefs);
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-xl font-bold">Mis avisos</h1>
      <p className="text-sm text-slate-600">
        Notificaciones al momento en este celular o computadora (y en la app Packatelas). Por WhatsApp solo te escribimos cuando registramos tu recolección y cuando el repartidor va en camino.
      </p>
      <Card>
        <ActionForm action={savePrefs} submitLabel="Guardar">
          <ul className="divide-y divide-slate-100">
            {CLIENT_PUSH_EVENTS.map((e) => (
              <li key={e.key} className="py-3">
                <label className="flex items-start gap-3">
                  <input type="checkbox" name={e.key} defaultChecked={prefs[e.key]} className="mt-1 h-5 w-5 accent-brand" />
                  <span>
                    <span className="block font-medium">{e.label}</span>
                    <span className="block text-sm text-slate-500">{e.hint}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </ActionForm>
      </Card>
      <p className="text-xs text-slate-500">En iPhone: abre el portal en Safari, toca Compartir → «Agregar a pantalla de inicio» y ábrelo desde ahí para activar las notificaciones.</p>
    </div>
  );
}
