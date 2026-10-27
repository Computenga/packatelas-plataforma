import { addDocument, isDocType, prisma } from "@packatelas/db";
import { getSessionUser } from "@/lib/session";
import { readDocUpload, removeFiles, saveDocUpload } from "@/lib/doc-upload";

/** RH sube documentos a cualquier expediente; el empleado solo al suyo [A22, A25]. */
export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user || user.role === "CLIENTE") return Response.json({ error: "No autorizado" }, { status: 401 });
  const up = await readDocUpload(request);
  if ("error" in up) return Response.json({ error: up.error }, { status: up.status });
  if (!(await isDocType(prisma, up.docType))) return Response.json({ error: "Tipo de documento inválido" }, { status: 400 });
  let employeeId = String(up.form.get("employeeId") ?? "");
  if (user.role !== "ADMIN") {
    const own = await prisma.employee.findUnique({ where: { userId: user.id }, select: { id: true } });
    if (!own) return Response.json({ error: "Tu usuario no está ligado a tu expediente" }, { status: 403 });
    employeeId = own.id;
  }
  if (!employeeId) return Response.json({ error: "Falta el empleado" }, { status: 400 });
  const key = await saveDocUpload(up);
  try {
    const d = await addDocument(prisma, { employeeId, docType: up.docType, fileKey: key, fileName: up.fileName, mime: up.mime }, user.id);
    await removeFiles(d.replacedKeys);
    return Response.json({ id: d.id });
  } catch (e) {
    await removeFiles([key]);
    return Response.json({ error: e instanceof Error ? e.message : "No se pudo guardar" }, { status: 400 });
  }
}
