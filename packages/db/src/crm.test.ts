import "dotenv/config";
import { afterAll, describe, expect, it } from "vitest";
import { prisma, createLead, setLeadStage, submitSignup, leadFromSignup, approveSignup, rejectSignup, advanceLeads, linkLeadClient, clientMatchesForLead, coolingClients } from "./index.ts";

const tag = String(Date.now()).slice(-7);
const phone = `55${tag}9`.padEnd(10, "1").slice(0, 10);
const createdClients: string[] = [];
const createdSignups: string[] = [];

afterAll(async () => {
  await prisma.lead.deleteMany({ where: { businessName: { contains: `CRM ${tag}` } } });
  for (const id of createdClients) {
    await prisma.order.deleteMany({ where: { clientId: id } });
    await prisma.mlAccount.deleteMany({ where: { clientId: id } });
    await prisma.user.deleteMany({ where: { clientId: id } });
    await prisma.branch.deleteMany({ where: { clientId: id } });
    await prisma.client.delete({ where: { id } }).catch(() => {});
  }
  await prisma.notification.deleteMany({ where: { dedupeKey: { in: createdSignups.map((s) => `bienvenida_registro:${s}`) } } });
  await prisma.appNotice.deleteMany({ where: { body: { contains: `CRM ${tag}` } } });
  await prisma.auditLog.deleteMany({ where: { summary: { contains: `CRM ${tag}` } } });
  await prisma.clientSignup.deleteMany({ where: { id: { in: createdSignups } } });
  await prisma.$disconnect();
});

const signup = (suffix: string, p = phone) =>
  submitSignup(prisma, {
    businessName: `Tienda CRM ${tag} ${suffix}`, contactName: "Ana Prueba", phone: p, email: `crm${tag}${suffix}@example.com`,
    zone: "cmx", pickupAddress: "Calle de prueba 123, Col. Centro, 06000", monthlyVolume: "50-100", salesChannels: "MercadoLibre",
    username: `crm${tag}${suffix}`, password: "secreta123",
  });

describe("CRM de prospectos", () => {
  it("no duplica el mismo teléfono y registra la actividad", async () => {
    const a = await createLead(prisma, { businessName: `Negocio CRM ${tag} A`, phone: `+52 1 ${phone}`, source: "WHATSAPP" });
    expect(a.created).toBe(true);
    const b = await createLead(prisma, { businessName: `Negocio CRM ${tag} A bis`, phone, source: "REFERIDO" });
    expect(b).toEqual({ id: a.id, created: false });
    const acts = await prisma.leadActivity.findMany({ where: { leadId: a.id } });
    expect(acts.some((x) => x.text.includes("Volvió a registrarse"))).toBe(true);
    await expect(setLeadStage(prisma, a.id, "PERDIDO")).rejects.toThrow();
    expect(await setLeadStage(prisma, a.id, "PERDIDO", null, { lostReason: "Precio" })).toBe(true);
    // Perdido: el siguiente registro con ese teléfono crea uno nuevo.
    const c = await createLead(prisma, { businessName: `Negocio CRM ${tag} A tercero`, phone });
    expect(c.created).toBe(true);
    await setLeadStage(prisma, c.id, "PERDIDO", null, { lostReason: "prueba" });
  });

  it("registro web → alta → conecta ML → primer envío → activo", async () => {
    const r = await signup("w", `56${tag}1`.padEnd(10, "7").slice(0, 10));
    if (!r.ok) throw new Error(r.error);
    createdSignups.push(r.id);
    const lead = await leadFromSignup(prisma, r.id);
    expect(lead?.created).toBe(true);
    const l0 = await prisma.lead.findUniqueOrThrow({ where: { id: lead!.id } });
    expect(l0.stage).toBe("NUEVO");
    expect(l0.source).toBe("REGISTRO_WEB");
    expect(l0.nextActionAt).not.toBeNull();

    const ap = await approveSignup(prisma, { signupId: r.id, tariffAmount: 100 });
    if (!ap.ok) throw new Error(ap.error);
    createdClients.push(ap.clientId);
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: lead!.id } })).stage).toBe("ALTA");

    await prisma.mlAccount.create({ data: { clientId: ap.clientId, mlUserId: BigInt(`9${tag}1`), nickname: `CRM${tag}`, status: "ACTIVE", accessTokenEnc: "x" } });
    await advanceLeads(prisma);
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: lead!.id } })).stage).toBe("ML_CONECTADO");

    const branch = await prisma.branch.findFirstOrThrow({ where: { clientId: ap.clientId } });
    const mk = (i: number) => prisma.order.create({ data: { code: `CRM-${tag}-${i}`, clientId: ap.clientId, branchId: branch.id, addressLine: "x", source: "MANUAL" } });
    await mk(0);
    await advanceLeads(prisma);
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: lead!.id } })).stage).toBe("PRIMER_ENVIO");
    for (let i = 1; i < 10; i++) await mk(i);
    await advanceLeads(prisma);
    const done = await prisma.lead.findUniqueOrThrow({ where: { id: lead!.id } });
    expect(done.stage).toBe("ACTIVO");
    expect(done.nextActionAt).toBeNull();
  });

  it("rechazar la solicitud deja el prospecto como perdido", async () => {
    const r = await signup("r", `57${tag}2`.padEnd(10, "3").slice(0, 10));
    if (!r.ok) throw new Error(r.error);
    createdSignups.push(r.id);
    const lead = await leadFromSignup(prisma, r.id);
    await rejectSignup(prisma, r.id, "Fuera de zona");
    const l = await prisma.lead.findUniqueOrThrow({ where: { id: lead!.id } });
    expect(l.stage).toBe("PERDIDO");
    expect(l.lostReason).toBe("Fuera de zona");
  });

  it("sugiere y liga el cliente que ya existe con el mismo correo", async () => {
    const linked = (await prisma.lead.findMany({ where: { clientId: { not: null } }, select: { clientId: true } })).map((x) => x.clientId!);
    const client = await prisma.client.findFirst({ where: { email: { not: null }, id: { notIn: linked } }, select: { id: true, email: true } });
    if (!client) return;
    const l = await createLead(prisma, { businessName: `Negocio CRM ${tag} L`, email: client.email!.toUpperCase() });
    const m = await clientMatchesForLead(prisma, l.id);
    expect(m.map((x) => x.id)).toContain(client.id);
    expect((await linkLeadClient(prisma, l.id, client.id)).ok).toBe(true);
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: l.id } })).stage).toBe("ALTA");
    await prisma.lead.delete({ where: { id: l.id } });
  });

  it("clientes que se enfrían: consulta válida", async () => {
    const rows = await coolingClients(prisma);
    expect(Array.isArray(rows)).toBe(true);
  });
});

describe("importar prerregistros", () => {
  it("separa recientes, viejos, repetidos y sin datos", async () => {
    const { importLeads } = await import("./index.ts");
    const now = new Date();
    const p1 = `58${tag}4`.padEnd(10, "5").slice(0, 10);
    const p2 = `59${tag}6`.padEnd(10, "6").slice(0, 10);
    const s = await importLeads(prisma, [
      { at: now.toISOString(), businessName: `Imp CRM ${tag} 1`, contactName: "Uno", phone: p1 },
      { at: new Date(now.getTime() - 90 * 86400_000).toISOString(), businessName: `Imp CRM ${tag} 2`, phone: p2 },
      { at: now.toISOString(), businessName: `Imp CRM ${tag} 1 otra vez`, phone: `+52${p1}` },
      { businessName: `Imp CRM ${tag} 3` },
    ]);
    expect(s).toMatchObject({ created: 1, lost: 1, repeated: 1, skipped: 1 });
    const old = await prisma.lead.findFirstOrThrow({ where: { businessName: `Imp CRM ${tag} 2` } });
    expect(old.stage).toBe("PERDIDO");
    expect(old.source).toBe("PRERREGISTRO");
  });
});
