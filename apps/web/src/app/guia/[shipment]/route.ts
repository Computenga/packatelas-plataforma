import { audit, diagnoseLabel, guiaData, prisma, rawMlLabel } from "@packatelas/db";
import { getSessionUser } from "@/lib/session";
import { STAFF_ROLES } from "@/lib/roles";
import { guiaPdf } from "@/lib/guia-pdf";

/**
 * Reimpresión de la guía de un envío ML en PDF 4×6 [Recuperados]. Personal de Packatelas: cualquier
 * envío; cliente: solo los suyos. El QR sale del escaneo de la etiqueta o, si no hay, de la etiqueta de ML.
 */
export async function GET(request: Request, ctx: { params: Promise<{ shipment: string }> }) {
  const user = await getSessionUser();
  if (!user) return new Response("Inicia sesión", { status: 401 });
  const { shipment } = await ctx.params;
  if (!/^\d{10,13}$/.test(shipment)) return new Response("Envío inválido", { status: 400 });
  const id = BigInt(shipment);

  const staff = (STAFF_ROLES as readonly string[]).includes(user.role);
  if (!staff) {
    if (user.role !== "CLIENTE" || !user.clientId) return new Response("No autorizado", { status: 403 });
    const [o, c] = await Promise.all([
      prisma.order.findUnique({ where: { mlShipmentId: id }, select: { clientId: true } }),
      prisma.mlFlexShipment.findUnique({ where: { shipmentId: id }, select: { clientId: true } }),
    ]);
    if ((o ?? c)?.clientId !== user.clientId) return new Response("No encontrado", { status: 404 });
  }

  const params = new URL(request.url).searchParams;
  if (params.get("diag") === "1" && user.role === "ADMIN") return Response.json(await diagnoseLabel(prisma, id).catch((e) => ({ error: String(e) })));
  if (params.get("original") === "pdf" && user.role === "ADMIN") {
    const l = await rawMlLabel(prisma, id, "pdf");
    return l ? new Response(new Uint8Array(l.bytes), { headers: { "Content-Type": l.contentType, "Cache-Control": "no-store" } }) : new Response("Sin etiqueta", { status: 404 });
  }
  // Sin QR escaneado se toma el de la etiqueta que genera ML (el mismo que imprime el vendedor).
  const g = await guiaData(prisma, id, { fetchQr: true });
  if (!g) return new Response("No encontrado", { status: 404 });
  if (!g.qrRaw) {
    return new Response(
      `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><body style="font-family:system-ui;max-width:32rem;margin:3rem auto;padding:0 1rem;color:#0e1b33">
<h1 style="font-size:1.2rem">No pudimos obtener la guía del envío ${g.shipmentId}</h1>
<p>MercadoLibre no entregó la etiqueta de este envío (puede estar cancelado, entregado hace tiempo o la cuenta del vendedor desconectada).</p>
<p>Escanea la etiqueta original con la cámara o el lector y vuelve a intentarlo.</p></body>`,
      { status: 409, headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  }
  const pdf = await guiaPdf(g);
  await audit(prisma, { actorUserId: user.id, action: "guia.reprinted", entity: "MlShipment", entityId: g.shipmentId, summary: `Reimprimió la guía ${g.shipmentId}` }).catch(() => {});
  return new Response(Buffer.from(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `${/PackatelasAndroid/.test(request.headers.get("user-agent") ?? "") ? "attachment" : "inline"}; filename="guia-${g.shipmentId}.pdf"`, "Cache-Control": "no-store" },
  });
}
