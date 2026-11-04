import "dotenv/config";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { copyDriveFiles, driveFileId, prisma } from "./index.ts";
import * as legacy from "./legacy-sync.ts";

const NO = 9921;
afterAll(async () => {
  await prisma.employee.deleteMany({ where: { employeeNo: NO } });
  await prisma.setting.deleteMany({ where: { key: "legacy.drive_copy" } });
  await prisma.$disconnect();
});

describe("archivos de Drive al servidor", () => {
  it("reconoce ligas de Drive", () => {
    expect(driveFileId("https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp_q/view?usp=drivesdk")).toBe("1AbCdEfGhIjKlMnOp_q");
    expect(driveFileId("https://drive.google.com/open?id=1AbCdEfGhIjKlMnOp_q")).toBe("1AbCdEfGhIjKlMnOp_q");
    expect(driveFileId("https://example.com/x.jpg")).toBeNull();
  });

  it("copia el expediente y anota lo que no se puede", async () => {
    vi.spyOn(legacy, "googleAccessToken").mockResolvedValue("tok");
    await prisma.setting.deleteMany({ where: { key: "legacy.drive_copy" } });
    const e = await prisma.employee.create({ data: { employeeNo: NO, name: "Docs Prueba" } });
    await prisma.employeeDocument.createMany({ data: [
      { employeeId: e.id, docType: "curp", fileKey: "drive:PDFfile0000001", mime: "application/octet-stream" },
      { employeeId: e.id, docType: "foto", fileKey: "drive:GONEfile000001", mime: "application/octet-stream" },
    ] });
    const pdf = Buffer.from("%PDF-1.4 prueba");
    const fetchImpl = (async (url: string) =>
      String(url).includes("PDFfile") ? new Response(pdf) : new Response("not found", { status: 404 })) as typeof fetch;
    const dir = await mkdtemp(path.join(tmpdir(), "up-"));
    const r = await copyDriveFiles(prisma, { uploadDir: dir, fetchImpl });
    expect(r).toMatchObject({ copied: 1, failed: 1 });
    const doc = await prisma.employeeDocument.findFirstOrThrow({ where: { employeeId: e.id, docType: "curp" } });
    expect(doc.fileKey).toMatch(/^docs\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.pdf$/);
    expect(doc.mime).toBe("application/pdf");
    expect((await readFile(path.join(dir, doc.fileKey))).toString()).toContain("%PDF");
    // El que falló ya no se reintenta.
    const r2 = await copyDriveFiles(prisma, { uploadDir: dir, fetchImpl });
    expect(r2).toMatchObject({ copied: 0, failed: 0 });
  });
});
