import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyWhatsappStatuses, flexInviteTargets, importMlSellers, isOptedOut, mxPhone, prisma, sendFlexInvites, setOptOut } from "./index.ts";

describe("teléfonos de México", () => {
  it("identifica formatos comunes", () => {
    expect(mxPhone("5529716275")?.phone).toBe("5529716275");
    expect(mxPhone("+52 1 55 2971 6275")?.phone).toBe("5529716275");
    expect(mxPhone("525529716275")?.phone).toBe("5529716275");
    expect(mxPhone("15529716275")?.phone).toBe("5529716275");
    expect(mxPhone("(01 55) 2971 6275")?.phone).toBe("5529716275");
    expect(mxPhone("445529716275")?.phone).toBe("5529716275"); // 044 sin el cero
    expect(mxPhone("0445529716275")?.phone).toBe("5529716275");
    expect(mxPhone("1722123456")).toBeNull(); // 10 dígitos que empiezan con 1: no es número válido
    expect(mxPhone("17221234567")?.phone).toBe("7221234567");
    const local = mxPhone("29716275");
    expect(local?.phone).toBe("5529716275");
    expect(local?.note).toMatch(/lada 55/);
    expect(mxPhone("0")).toBeNull();
    expect(mxPhone("1234567")).toBeNull();
    expect(mxPhone("552971627")).toBeNull();
  });
});

const n = String(Date.now()).slice(-7);
const seller = (i: number) => `9${n}${i}`;
const ph = (i: number) => `56${n.slice(-6)}${i}${i}`.slice(0, 10);
let clientId = "";

beforeAll(async () => {
  clientId = (await prisma.client.create({ data: { publicId: `mls${n}`, name: "Ya cliente", paymentReference: `MLS${n}`, tariffAmount: 0, phone: ph(3) } })).id;
});
afterAll(async () => {
  const leads = await prisma.lead.findMany({ where: { mlSellerId: { in: [1, 2, 3, 4].map((i) => BigInt(seller(i))) } }, select: { id: true } });
  await prisma.notification.deleteMany({ where: { dedupeKey: { in: leads.map((l) => `flex_invite:${l.id}`) } } });
  await prisma.lead.deleteMany({ where: { id: { in: leads.map((l) => l.id) } } });
  await prisma.client.delete({ where: { id: clientId } });
  await setOptOut(prisma, ph(2), false);
  await prisma.$disconnect();
});

describe("listado de vendedores de ML", () => {
  it("importa, no duplica ni mete clientes, invita y procesa respuestas", async () => {
    const rows = [
      { sellerId: seller(1), nickname: "TIENDA_UNO", phone1: `52${ph(1)}`, phone2: "0", email: `uno${n}@ejemplo.mx`, city: "Iztapalapa", state: "MX-DIF", address: "Calle 1 MX-DIF Iztapalapa" },
      { sellerId: seller(2), nickname: "TIENDA_DOS", phone1: "0", phone2: ph(2), email: null, city: "Naucalpan", state: "MX-MEX", address: "Av 2 Naucalpan" },
      { sellerId: seller(3), nickname: "YA_CLIENTE", phone1: ph(3), phone2: null, email: null, city: null, state: "MX-DIF", address: null },
      { sellerId: seller(4), nickname: "SIN_TEL", phone1: "0", phone2: "0", email: `cuatro${n}@ejemplo.mx`, city: "Coyoacán", state: "MX-DIF", address: null },
    ];
    const s = await importMlSellers(prisma, rows);
    expect(s).toMatchObject({ created: 3, withWhatsapp: 2, alreadyClients: 1 });
    expect((await importMlSellers(prisma, rows)).repeated).toBe(3);
    const uno = await prisma.lead.findUniqueOrThrow({ where: { mlSellerId: BigInt(seller(1)) } });
    expect(uno).toMatchObject({ source: "LISTA_ML", phone: ph(1), zone: "cmx", stage: "NUEVO", nextActionAt: null });

    const t = await flexInviteTargets(prisma);
    const mine = t.targets.filter((x) => [ph(1), ph(2)].some((p) => x.phone.endsWith(p)));
    expect(mine).toHaveLength(2);
    expect(mine[0].preview).toMatch(/Packatelas/);

    const sent = await sendFlexInvites(prisma, null, { limit: 500 });
    expect(sent.queued).toBeGreaterThanOrEqual(2);
    expect((await flexInviteTargets(prisma)).targets.some((x) => x.phone.endsWith(ph(1)))).toBe(false); // una sola vez

    // Respuestas: botón «Me interesa» y «No me interesa».
    const msg = (from: string, text: string) => ({ entry: [{ changes: [{ value: { messages: [{ from, button: { text } }] } }] }] });
    await applyWhatsappStatuses(prisma, msg(`521${ph(1)}`, "Me interesa"));
    await applyWhatsappStatuses(prisma, msg(`52${ph(2)}`, "No me interesa"));
    expect((await prisma.lead.findUniqueOrThrow({ where: { mlSellerId: BigInt(seller(1)) } })).stage).toBe("INTERESADO");
    expect((await prisma.lead.findUniqueOrThrow({ where: { mlSellerId: BigInt(seller(2)) } })).stage).toBe("PERDIDO");
    expect(await isOptedOut(prisma, `52${ph(2)}`)).toBe(true);
  });
});

describe("plantilla de invitación", () => {
  it("lleva botón al WhatsApp oficial con la cuenta del vendedor", async () => {
    const { whatsappTemplatePayload, templateSendComponents } = await import("./notifications.ts");
    const p = whatsappTemplatePayload("invitacion_flex");
    expect(JSON.stringify(p.components[1])).toContain("wa.me/525664275415");
    const c = templateSendComponents("pk_invitacion_flex", ["MI TIENDA"]);
    expect(c[1]).toMatchObject({ type: "button", sub_type: "url", index: "0", parameters: [{ text: "MI%20TIENDA" }] });
    expect(templateSendComponents("pk_en_camino", ["a", "b"])).toHaveLength(1);
  });
  it("responde solo con el número oficial", async () => {
    const { flexInviteAutoReply } = await import("./ml-sellers.ts");
    expect(flexInviteAutoReply("otro", "TIENDA X")).toMatch(/56 6427 5415.*wa\.me\/525664275415/);
  });
});
