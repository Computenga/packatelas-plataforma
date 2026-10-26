import { audit, prisma } from "@packatelas/db";
import { getSessionUser } from "@/lib/session";
import { BAJA_DOCS, INGRESO_DOCS, bajaPackage, generateBaja, generateIngreso, validateBaja, type BajaInput, type IngresoInput } from "@/lib/rh-docs";
import { getEmpresa } from "@/lib/rh-empresa";

/** Genera documentos de RH (.docx o paquete .zip) con las plantillas de Computenga. */
export async function POST(request: Request) {
  const user = await getSessionUser();
  if (user?.role !== "ADMIN") return Response.json({ error: "No autorizado" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { kind?: string; doc?: string; employeeId?: string; input?: unknown } | null;
  if (!body?.input || typeof body.input !== "object") return Response.json({ error: "Datos incompletos" }, { status: 400 });
  try {
    let file: { filename: string; data: Buffer };
    if (body.kind === "baja") {
      const b = body.input as BajaInput;
      const missing = validateBaja(b);
      if (missing.length) return Response.json({ error: `Falta: ${missing.join(", ")}` }, { status: 400 });
      if (body.doc === "paquete") file = await bajaPackage(b);
      else if ((BAJA_DOCS as readonly string[]).includes(body.doc ?? "")) file = generateBaja(body.doc as (typeof BAJA_DOCS)[number], b);
      else return Response.json({ error: "Documento inválido" }, { status: 400 });
    } else if (body.kind === "ingreso" && (INGRESO_DOCS as readonly string[]).includes(body.doc ?? "")) {
      const i = body.input as IngresoInput;
      if (!i.nombre?.trim() || !i.fechaInicio || !(i.salario > 0)) return Response.json({ error: "Falta: nombre, fecha de inicio o salario" }, { status: 400 });
      file = generateIngreso(body.doc as (typeof INGRESO_DOCS)[number], await getEmpresa(), i);
    } else return Response.json({ error: "Documento inválido" }, { status: 400 });
    if (body.employeeId) await audit(prisma, { actorUserId: user.id, action: "rh.document_generated", entity: "Employee", entityId: body.employeeId, summary: `Generado: ${file.filename}` }).catch(() => {});
    return new Response(new Uint8Array(file.data), {
      headers: {
        "Content-Type": file.filename.endsWith(".zip") ? "application/zip" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${file.filename}"`, "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "No se pudo generar" }, { status: 500 });
  }
}
