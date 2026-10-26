import "dotenv/config";
import { afterAll, describe, expect, it } from "vitest";
import {
  prisma, createApplication, findApplication, addDocument, missingForSubmit, submitApplication, reviewDocument,
  approveApplication, employeeFile, docTypesFor,
} from "./index.ts";

const n = 500000 + Number(String(Date.now()).slice(-5));
let appId = "";
afterAll(async () => {
  await prisma.employeeDocument.deleteMany({ where: { OR: [{ applicationId: appId }, { employee: { employeeNo: n } }] } });
  await prisma.auditLog.deleteMany({ where: { summary: { contains: `#${n}` } } });
  await prisma.employee.deleteMany({ where: { employeeNo: n } });
  await prisma.hireApplication.deleteMany({ where: { id: appId } });
  await prisma.$disconnect();
});

describe("alta por enlace", () => {
  it("documentos según el puesto", async () => {
    const rep = (await docTypesFor(prisma, "repartidor")).map((d) => d.key);
    const ofi = (await docTypesFor(prisma, "oficina")).map((d) => d.key);
    expect(rep).toContain("licencia");
    expect(ofi).not.toContain("licencia");
    expect(ofi).toContain("ine_frente");
  });

  it("solicitud completa → revisión → empleado con expediente", async () => {
    const admin = (await prisma.user.findFirstOrThrow({ where: { role: "ADMIN" } })).id;
    const { id, token } = await createApplication(prisma, "repartidor");
    appId = id;
    expect((await findApplication(prisma, token))?.id).toBe(id);
    expect(await findApplication(prisma, "x".repeat(30))).toBeNull();

    await prisma.hireApplication.update({ where: { id }, data: { name: "Ana Solicitante Prueba", phone: "5511112222", curp: "XEXX010101HNEXXXA4" } });
    const types = (await docTypesFor(prisma, "repartidor")).filter((t) => t.required);
    expect((await missingForSubmit(prisma, id)).length).toBe(types.length);
    for (const t of types) await addDocument(prisma, { applicationId: id, docType: t.key, fileKey: `docs/2026/10/${t.key}.pdf`, mime: "application/pdf" });
    // Reemplazar un pendiente no duplica
    await addDocument(prisma, { applicationId: id, docType: "curp", fileKey: "docs/2026/10/curp2.pdf", mime: "application/pdf" });
    expect(await prisma.employeeDocument.count({ where: { applicationId: id, docType: "curp" } })).toBe(1);
    expect(await submitApplication(prisma, id)).toEqual({ ok: true });

    const docs = await prisma.employeeDocument.findMany({ where: { applicationId: id } });
    await expect(reviewDocument(prisma, docs[0].id, "RECHAZADO", "", admin)).rejects.toThrow(/por qué/);
    await reviewDocument(prisma, docs[0].id, "RECHAZADO", "Borrosa", admin);
    expect(await missingForSubmit(prisma, id)).toEqual([expect.stringMatching(/rechazado/)]);
    expect(await approveApplication(prisma, id, { employeeNo: n }, admin)).toMatchObject({ ok: false, error: expect.stringMatching(/Faltan por aprobar/) });
    for (const d of docs) await reviewDocument(prisma, d.id, "APROBADO", null, admin);

    const r = await approveApplication(prisma, id, { employeeNo: n, entryTime: "10:00" }, admin);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const e = await prisma.employee.findUniqueOrThrow({ where: { id: r.employeeId } });
    expect(e).toMatchObject({ name: "Ana Solicitante Prueba", kind: "repartidor", entryTime: "10:00", curp: "XEXX010101HNEXXXA4" });
    const file = await employeeFile(prisma, e.id);
    expect(file.every((f) => f.doc?.status === "APROBADO" || !f.type.required)).toBe(true);
    expect(await approveApplication(prisma, id, { employeeNo: n + 1 }, admin)).toMatchObject({ ok: false });
  });
});
