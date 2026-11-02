import type { Metadata } from "next";
import { prisma } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import { Card } from "@/components/ui";
import { ActionForm } from "@/components/action-form";
import { PhotoForm } from "./photo-form";
import { updatePhone } from "./actions";
import { FlexLink } from "./flex-link";

export const metadata: Metadata = { title: "Mi perfil" };

/** Perfil del repartidor: foto y teléfono que ve la tienda cuando va en camino a recolectar. */
export default async function PerfilPage() {
  const user = await requireUser(["REPARTIDOR"]);
  const d = await prisma.driver.findUnique({ where: { userId: user.id }, select: { id: true, phone: true, photoKey: true, vehicleType: true, plate: true } });
  if (!d) return <p className="text-sm text-slate-600">Tu usuario no tiene perfil de repartidor. Pídelo en oficina.</p>;
  const flex = await prisma.flexIdentity.findMany({ where: { driverId: d.id }, select: { flexDriverId: true } });
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold">Mi perfil</h1>
      <p className="text-sm text-slate-600">Cuando vas en camino a una recolección, la tienda ve tu nombre, tu foto y tu teléfono en el enlace de seguimiento.</p>
      <Card title="Mercado Libre Flex">
        {flex.length > 0 && (
          <p className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            ✅ Vinculado (ID {flex.map((f) => f.flexDriverId.toString()).join(", ")}). Lo que tomes en Flex se te asigna solo. Si cambiaste de cuenta Flex, vuelve a escanear.
          </p>
        )}
        <FlexLink />
      </Card>
      <Card title="Foto">
        <PhotoForm src={d.photoKey ? `/api/foto-repartidor/${d.id}?v=${encodeURIComponent(d.photoKey.slice(-12))}` : null} name={user.name} />
      </Card>
      <Card title="Datos">
        <p className="mb-3 text-sm"><span className="text-slate-500">Nombre:</span> {user.name}</p>
        <ActionForm action={updatePhone} submitLabel="Guardar teléfono">
          <label className="block text-sm">
            <span className="font-medium text-slate-700">Teléfono (WhatsApp)</span>
            <input name="phone" inputMode="tel" defaultValue={d.phone ?? ""} placeholder="10 dígitos" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" />
          </label>
        </ActionForm>
        {(d.vehicleType || d.plate) && <p className="mt-3 text-xs text-slate-500">Vehículo: {[d.vehicleType, d.plate].filter(Boolean).join(" · ")}</p>}
      </Card>
    </div>
  );
}
