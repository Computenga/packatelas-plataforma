import { audit, diagnoseLabel, guiaData, prisma } from "@packatelas/db";
import { getSessionUser } from "@/lib/session";
import { STAFF_ROLES } from "@/lib/roles";
import { guiaPdf } from "@/lib/guia-pdf";

/**
 * Reimpresión de la guía de un envío ML en PDF 4×6 [Recuperados]. Personal de Packatelas: cualquier
 * envío; cliente: solo los suyos. `?qr=ml` pide la etiqueta a ML si aún no tenemos el QR.
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
  const fetchQr = params.get("qr") === "ml";
  const g = await guiaData(prisma, id, { fetchQr });
  if (!g) return new Response("No encontrado", { status: 404 });
  if (!g.qrRaw) {
    return new Response(
      `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><body style="font-family:system-ui;max-width:32rem;margin:3rem auto;padding:0 1rem;color:#0f1e4a">
<h1 style="font-size:1.2rem">Aún no tenemos el QR original del envío ${g.shipmentId}</h1>
<p>El QR (con su código de seguridad) se guarda al escanear la etiqueta o cuando el vendedor la imprime en MercadoLibre.</p>
<p>Puedo pedírselo a MercadoLibre ahora. <strong>Si el vendedor aún no la imprimía, MercadoLibre la marcará como impresa.</strong></p>
<p><a href="?qr=ml" style="display:inline-block;background:#0f1e4a;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Pedir QR a MercadoLibre y generar guía</a></p></body>`,
      { status: 409, headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  }
  const pdf = await guiaPdf(g);
  await audit(prisma, { actorUserId: user.id, action: "guia.reprinted", entity: "MlShipment", entityId: g.shipmentId, summary: `Reimprimió la guía ${g.shipmentId}` }).catch(() => {});
  return new Response(Buffer.from(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="guia-${g.shipmentId}.pdf"`, "Cache-Control": "no-store" },
  });
}
