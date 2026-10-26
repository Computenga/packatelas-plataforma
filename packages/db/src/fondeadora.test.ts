import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, parseFondeadoraDeposit, matchClient, ingestFondeadoraEmail, getClientBalance } from "./index.ts";

// Avisos sintéticos con el mismo formato que los reales (sin datos de clientes reales).
const aviso = (sender: string, amount: string, concept: string, key: string) =>
  `Recibiste un depósito\n\n${sender} depositó $${amount} a tu cuenta  por el concepto de ${concept}.\n\nClave de rastreo: ${key}.\n\nConsulta el detalle de este movimiento desde tu aplicación.\n\nIr a mi cuenta ( https://app-empresarial.fondeadora.com/login )`;

describe("parseFondeadoraDeposit", () => {
  it("lee ordenante, monto con comas, concepto y clave", () => {
    expect(parseFondeadoraDeposit(aviso("TIENDA DE PRUEBA SA", "1,035.00", "Packatelas CMX00114", "CPO123456789012"))).toEqual({
      sender: "TIENDA DE PRUEBA SA",
      amount: "1035.00",
      concept: "Packatelas CMX00114",
      trackingKey: "CPO123456789012",
    });
  });
  it("acepta montos sin comas y claves largas", () => {
    const r = parseFondeadoraDeposit(aviso("JUAN PRUEBA", "20605.00", "packatelas cmx00151", "2026102440044B36L0000505804699"));
    expect(r?.amount).toBe("20605.00");
    expect(r?.trackingKey).toBe("2026102440044B36L0000505804699");
  });
  it("ignora correos que no son depósitos", () => {
    expect(parseFondeadoraDeposit("Transferencia exitosa\nEnviaste $100.00 a ...")).toBeNull();
    expect(parseFondeadoraDeposit("Autentica tu inicio de sesión. Tu código es 123456")).toBeNull();
  });
});

describe("matchClient", () => {
  const clients = [
    { id: "a", publicId: "cmx00114", paymentReference: "PKT00114" },
    { id: "b", publicId: "cmx00127-granjas", paymentReference: "PKT00127" },
    { id: "c", publicId: "cmx00127-patzcuaro", paymentReference: "PKT00128" },
    { id: "d", publicId: "cmx00141", paymentReference: "PKT00141" },
  ];
  it("exacto por ID público en cualquier mayúscula", () => {
    expect(matchClient("Packatelas CMX00114", clients)).toEqual({ kind: "exact", clientId: "a", via: "cmx00114" });
    expect(matchClient("pago cmx114", clients)).toMatchObject({ kind: "exact", clientId: "a" });
  });
  it("exacto por subcuenta o por referencia de pago", () => {
    expect(matchClient("packatelas cmx00127-granjas", clients)).toMatchObject({ kind: "exact", clientId: "b" });
    expect(matchClient("PKT00128", clients)).toMatchObject({ kind: "exact", clientId: "c" });
  });
  it("número de varias subcuentas o prefijo con error: solo sugerencia", () => {
    expect(matchClient("packatelas cmx00127", clients).kind).toBe("suggestion");
    expect(matchClient("emx00141", clients)).toMatchObject({ kind: "suggestion" });
  });
  it("sin referencia: no se aplica", () => {
    expect(matchClient("fondeo kenia", clients).kind).toBe("none");
    expect(matchClient("MERCADO*PAGO", clients).kind).toBe("none");
  });
});

describe("ingestFondeadoraEmail", () => {
  const tag = `f${Date.now()}`;
  let clientId: string;
  let publicId: string;
  beforeAll(async () => {
    publicId = `cmx9${Date.now().toString().slice(-4)}`;
    const c = await prisma.client.create({ data: { publicId, name: "Fondeo", paymentReference: `PKT${tag}`, tariffAmount: 0 } });
    clientId = c.id;
  });
  afterAll(async () => {
    const pays = await prisma.payment.findMany({ where: { externalId: { startsWith: tag } }, select: { id: true } });
    await prisma.ledgerEntry.deleteMany({ where: { paymentId: { in: pays.map((p) => p.id) } } });
    await prisma.auditLog.deleteMany({ where: { entityId: { in: pays.map((p) => p.id) } } });
    await prisma.payment.deleteMany({ where: { id: { in: pays.map((p) => p.id) } } });
    await prisma.client.delete({ where: { id: clientId } });
    await prisma.$disconnect();
  });

  it("aplica solo, y leer el correo de nuevo (o en paralelo) no abona dos veces", async () => {
    const email = { externalId: `${tag}-1`, receivedAt: new Date(), text: aviso("CLIENTE X", "1,250.50", `Packatelas ${publicId.toUpperCase()}`, `${tag}K1`.toUpperCase()) };
    const r = await Promise.all([ingestFondeadoraEmail(prisma, email), ingestFondeadoraEmail(prisma, email), ingestFondeadoraEmail(prisma, email)]);
    expect(r.filter((x) => x.status === "applied")).toHaveLength(1);
    expect((await getClientBalance(prisma, clientId)).toString()).toBe("-1250.5");
  });

  it("misma clave de rastreo en otro correo también es duplicado", async () => {
    const r = await ingestFondeadoraEmail(prisma, { externalId: `${tag}-2`, receivedAt: new Date(), text: aviso("CLIENTE X", "1,250.50", publicId, `${tag}K1`.toUpperCase()) });
    expect(r.status).toBe("duplicate");
  });

  it("sin referencia queda sin identificar", async () => {
    const r = await ingestFondeadoraEmail(prisma, { externalId: `${tag}-3`, receivedAt: new Date(), text: aviso("ALGUIEN", "500.00", "pago envios", `${tag}K3`.toUpperCase()) });
    expect(r.status).toBe("unidentified");
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: r.paymentId } })).status).toBe("UNIDENTIFIED");
  });
});
