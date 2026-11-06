import "dotenv/config";
import { afterAll, describe, expect, it } from "vitest";
import { applyWhatsappStatuses, conversation, listConversations, prisma, recordOutbound, replyWindow } from "./index.ts";

const ten = `55${String(Date.now()).slice(-8)}`;
const key = `52${ten}`;
afterAll(async () => {
  await prisma.waMessage.deleteMany({ where: { phone: key } });
  await prisma.$disconnect();
});

describe("bandeja de WhatsApp", () => {
  it("guarda lo que escriben (sin duplicar), abre la ventana de 24 h y registra respuestas", async () => {
    const body = { entry: [{ changes: [{ value: { contacts: [{ wa_id: `521${ten}`, profile: { name: "Doña Prueba" } }], messages: [{ id: `wamid.${ten}`, from: `521${ten}`, type: "text", text: { body: "Hola, ¿cuánto cuesta el envío?" } }] } }] }] };
    const sent: string[] = [];
    await applyWhatsappStatuses(prisma, body, async (_to, t) => { sent.push(t); return "x"; });
    await applyWhatsappStatuses(prisma, body); // WhatsApp reintenta el mismo aviso
    expect(await prisma.waMessage.count({ where: { phone: key, direction: "in" } })).toBe(1);
    expect(sent).toHaveLength(0); // no es prospecto invitado: no hay acuse automático
    expect((await replyWindow(prisma, key)).open).toBe(true);
    expect((await replyWindow(prisma, key, new Date(Date.now() + 25 * 3600_000))).open).toBe(false);
    const c = (await listConversations(prisma)).find((x) => x.phone === key)!;
    expect(c).toMatchObject({ name: "Doña Prueba", unread: 1, windowOpen: true });
    await recordOutbound(prisma, { phone: key, kind: "text", text: "Hola, te comparto tarifas", waId: `wamid.out.${ten}` });
    await applyWhatsappStatuses(prisma, { entry: [{ changes: [{ value: { statuses: [{ id: `wamid.out.${ten}`, status: "read" }] } }] }] });
    const msgs = await conversation(prisma, key);
    expect(msgs.map((m) => [m.direction, m.status ?? null])).toEqual([["in", null], ["out", "read"]]);
    expect((await listConversations(prisma)).find((x) => x.phone === key)!.unread).toBe(0);
  });
});
