import QRCode from "qrcode";

export type LabelOrder = {
  code: string; recipientName: string | null; recipientPhone: string | null; addressLine: string | null; neighborhood: string | null;
  city: string | null; state: string | null; zip: string | null; instructions: string | null;
  client: { name: string; publicId: string }; branch: { name: string } | null;
  /** Pago contra entrega: importe que el repartidor cobra al entregar. */
  codAmount?: { toString(): string } | number | null;
};

const MXN = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" });

/** Etiqueta 10×15 cm de envío propio (PK-): el QR lleva el código, que los escáneres ya reconocen [C04, A03]. */
export async function ShippingLabel({ order }: { order: LabelOrder }) {
  const qr = await QRCode.toString(order.code, { type: "svg", margin: 0, errorCorrectionLevel: "M" });
  const cod = order.codAmount != null ? Number(order.codAmount.toString()) : 0;
  return (
    <section className="label-page mx-auto flex h-[150mm] w-[100mm] flex-col border border-slate-300 bg-white p-[6mm] text-slate-900 print:border-0">
      <div className="flex items-center justify-between border-b-2 border-slate-900 pb-2">
        <span className="text-lg font-black tracking-tight">PACKATELAS</span>
        <span className="text-xs">{order.client.publicId.toUpperCase()}</span>
      </div>
      {cod > 0 && (
        // Negro sólido con texto blanco: se distingue a simple vista y sale bien en impresora térmica.
        <div className="mt-2 rounded-sm bg-black px-2 py-1.5 text-center text-white [print-color-adjust:exact] [-webkit-print-color-adjust:exact]">
          <p className="text-[15px] font-black leading-none tracking-wide">POR COBRAR · PAGO CONTRA ENTREGA</p>
          <p className="mt-1 text-[30px] font-black leading-none tabular-nums">{MXN.format(cod)}</p>
          <p className="mt-1 text-[10px] font-semibold leading-none">Cobrar al destinatario antes de entregar</p>
        </div>
      )}
      <div className={`mx-auto ${cod > 0 ? "my-2 w-[38mm]" : "my-4 w-[48mm]"}`} dangerouslySetInnerHTML={{ __html: qr }} />
      <p className="text-center text-2xl font-bold tabular-nums">{order.code}</p>
      <div className="mt-4 space-y-1 border-t border-slate-300 pt-3 text-sm">
        <p className="text-[10px] text-slate-500">Entregar a</p>
        <p className="text-base font-bold leading-tight">{order.recipientName}</p>
        {order.recipientPhone && <p>Tel. {order.recipientPhone}</p>}
        <p className="leading-snug">{[order.addressLine, order.neighborhood].filter(Boolean).join(", ")}</p>
        <p className="leading-snug">{[order.city, order.state, order.zip && `CP ${order.zip}`].filter(Boolean).join(", ")}</p>
        {order.instructions && <p className="text-xs italic">{order.instructions}</p>}
      </div>
      <p className="mt-auto border-t border-slate-300 pt-2 text-[10px] text-slate-500">
        Remitente: {order.client.name}{order.branch ? ` · ${order.branch.name}` : ""}
      </p>
    </section>
  );
}
