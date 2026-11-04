import "dotenv/config";
import { afterAll, describe, expect, it } from "vitest";
import { portalInviteTargets, prisma, sendPortalInvites, setInviteOmit } from "./index.ts";

const tag = `pi${Date.now()}`;
const ids: string[] = [];
afterAll(async () => {
  await prisma.notification.deleteMany({ where: { clientId: { in: ids } } });
  await prisma.user.deleteMany({ where: { clientId: { in: ids } } });
  await prisma.client.deleteMany({ where: { id: { in: ids } } });
  await prisma.setting.deleteMany({ where: { key: "portal_invite.omit" } });
  await prisma.$disconnect();
});
const mk = async (n: string, phone: string, login: boolean) => {
  const c = await prisma.client.create({ data: { publicId: `${tag}${n}`, name: `Tienda ${n}`, contactName: `Ana ${n}`, phone, paymentReference: `${tag}${n}`.toUpperCase() } });
  ids.push(c.id);
  await prisma.user.create({ data: { username: `${tag}${n}`, name: "x", role: "CLIENTE", passwordHash: "x", clientId: c.id, mustChangePassword: !login, lastLoginAt: login ? new Date() : null } });
  return c;
};

describe("invitación al portal", () => {
  it("agrupa por teléfono, elige plantilla, respeta exclusiones y no repite en el día", async () => {
    const a = await mk("a", "5500000001", false);
    await mk("b", "55 0000 0001", false); // mismo número
    const c = await mk("c", "5500000002", true); // ya activó, sin ML
    const d = await mk("d", "5500000003", false);
    await setInviteOmit(prisma, d.id, true);
    const { groups } = await portalInviteTargets(prisma);
    const mine = groups.filter((g) => g.clients.some((x) => ids.includes(x.id)));
    expect(mine.length).toBe(3);
    const ga = mine.find((g) => g.phone === "525500000001")!;
    expect(ga.clients.length).toBe(2);
    expect(ga.event).toBe("acceso_portal");
    expect(ga.params).toEqual(["Ana", a.publicId.toLowerCase()]);
    expect(mine.find((g) => g.clients[0].id === c.id)!.event).toBe("conectar_ml");
    expect(mine.find((g) => g.clients[0].id === d.id)!.omitted).toBe(true);
    await sendPortalInvites(prisma, (await prisma.user.findFirstOrThrow({ where: { clientId: a.id } })).id);
    const n = await prisma.notification.findMany({ where: { clientId: { in: ids } } });
    expect(n.length).toBe(2);
    expect(n.find((x) => x.to === "525500000001")?.template).toBe("pk_invitacion_portal");
    await sendPortalInvites(prisma, (await prisma.user.findFirstOrThrow({ where: { clientId: a.id } })).id);
    expect(await prisma.notification.count({ where: { clientId: { in: ids } } })).toBe(2);
  });
});
