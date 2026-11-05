import type { Metadata } from "next";
import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { prisma } from "@packatelas/db";
import { getSessionUser } from "@/lib/session";
import { vehicleQrText } from "@/lib/vehicle-qr";
import { PrintButton } from "../etiqueta/[id]/print-button";

export const metadata: Metadata = { title: "Etiquetas QR de motos" };

/**
 * Etiqueta de llavero para impresora térmica: 2" × 1" horizontal, una por hoja, con 4 mm de
 * margen por si el llavero recorta las orillas. Folio grande, marca y modelo a la izquierda; QR a la derecha.
 * ?ids=a,b,c para unas motos; sin ids, todas las activas.
 */
export default async function EtiquetaMotoPage({ searchParams }: PageProps<"/etiqueta-moto">) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!["ADMIN", "MECANICO"].includes(user.role)) redirect("/");
  const sp = await searchParams;
  const ids = String(sp.ids ?? "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 200);
  const vehicles = await prisma.vehicle.findMany({
    where: ids.length ? { id: { in: ids } } : { status: { not: "BAJA" } },
    orderBy: { code: "asc" },
    select: { id: true, code: true, brand: true, model: true },
  });
  const labels = await Promise.all(
    vehicles.map(async (v) => ({ ...v, svg: await QRCode.toString(vehicleQrText(v.code), { type: "svg", margin: 0, errorCorrectionLevel: "M" }) })),
  );

  return (
    <main className="min-h-dvh bg-slate-100 p-4 print:bg-white print:p-0">
      <style>{`
        @page { size: 2in 1in; margin: 0 }
        @media print { .no-print { display: none !important } }
        .moto-label { width: 2in; height: 1in; padding: 4mm; box-sizing: border-box; break-after: page; page-break-after: always; overflow: hidden; }
        .moto-label:last-child { break-after: auto; page-break-after: auto; }
        .moto-label svg { width: 100%; height: 100%; display: block; }
        .moto-label * { color: #000; }
      `}</style>
      <div className="no-print mx-auto mb-4 max-w-md space-y-2">
        <div className="flex items-center justify-between">
          <a href="/mecanico/motos" className="text-sm text-brand">← Motos</a>
          <PrintButton />
        </div>
        <p className="text-xs text-slate-600">
          {labels.length} etiqueta(s) de 2″ × 1″. Al imprimir elige la impresora térmica, tamaño de papel 2×1 pulgadas (50.8 × 25.4 mm), escala 100 % y sin márgenes.
        </p>
      </div>
      <div className="flex flex-col items-center gap-4 print:block">
        {labels.map((v) => {
          // El folio ocupa lo más que quepa en ~23 mm de ancho.
          const size = Math.min(9, 23 / (Math.max(v.code.length, 3) * 0.62));
          return (
            <section key={v.id} className="moto-label flex items-center gap-[2mm] bg-white font-sans shadow print:shadow-none">
              <div className="min-w-0 flex-1 leading-none">
                <p className="whitespace-nowrap font-black tracking-tight" style={{ fontSize: `${size}mm` }}>{v.code}</p>
                {v.brand && <p className="mt-[1.2mm] truncate text-[2.8mm] font-bold uppercase">{v.brand}</p>}
                {v.model && <p className="mt-[0.6mm] truncate text-[2.6mm] font-semibold">{v.model}</p>}
              </div>
              <div className="h-full shrink-0" style={{ aspectRatio: "1 / 1" }} dangerouslySetInnerHTML={{ __html: v.svg }} />
            </section>
          );
        })}
        {labels.length === 0 && <p className="text-sm text-slate-500">No hay motos para imprimir.</p>}
      </div>
    </main>
  );
}
