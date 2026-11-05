import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { prisma } from "@packatelas/db";
import { getSessionUser } from "@/lib/session";
import { STAFF_ROLES } from "@/lib/roles";
import { ShippingLabel } from "@/components/shipping-label";
import { PrintButton } from "../[id]/print-button";

export const metadata: Metadata = { title: "Etiquetas" };

/** Varias etiquetas 10×15 cm, una por hoja (?ids=a,b,c). La tienda solo imprime las suyas. */
export default async function EtiquetasPage({ searchParams }: PageProps<"/etiqueta/varias">) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const ids = String((await searchParams).ids ?? "").split(",").filter(Boolean).slice(0, 200);
  const staff = STAFF_ROLES.includes(user.role);
  if (!staff && !(user.role === "CLIENTE" && user.clientId)) redirect("/login");
  const orders = await prisma.order.findMany({
    where: { id: { in: ids }, ...(staff ? {} : { clientId: user.clientId! }) },
    include: { client: { select: { name: true, publicId: true } }, branch: { select: { name: true } } },
    orderBy: { code: "asc" },
  });
  return (
    <main className="min-h-dvh bg-slate-100 p-4 print:bg-white print:p-0">
      <style>{`@page { size: 100mm 150mm; margin: 0 } @media print { .no-print { display: none } } .label-page { break-after: page } .label-page:last-child { break-after: auto }`}</style>
      <div className="no-print mx-auto mb-4 flex max-w-[100mm] items-center justify-between">
        <span className="text-sm text-slate-600">{orders.length} etiqueta(s)</span>
        <PrintButton />
      </div>
      <div className="space-y-4 print:space-y-0">
        {orders.map((o) => <ShippingLabel key={o.id} order={o} />)}
      </div>
    </main>
  );
}
