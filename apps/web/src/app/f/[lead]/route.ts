import { flexInviteClick, OFFICIAL_WA, prisma } from "@packatelas/db";

/** Botón «Escribir a Packatelas» de la invitación a Flex: registra el clic y abre el WhatsApp oficial. */
export async function GET(_: Request, ctx: { params: Promise<{ lead: string }> }) {
  const { lead } = await ctx.params;
  const url = await flexInviteClick(prisma, lead).catch(() => `https://wa.me/${OFFICIAL_WA}`);
  return new Response(null, { status: 302, headers: { Location: url, "Cache-Control": "no-store" } });
}
