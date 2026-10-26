import { addDocument, findApplication, prisma } from "@packatelas/db";
import { readDocUpload } from "@/lib/doc-upload";

/** La persona en proceso de alta sube un documento con su enlace privado [A25]. */
export async function POST(request: Request, ctx: RouteContext<"/api/alta/[token]/doc">) {
  const app = await findApplication(prisma, (await ctx.params).token);
  if (!app) return Response.json({ error: "Enlace inválido" }, { status: 404 });
  if (app.status === "APROBADA" || app.status === "RECHAZADA") return Response.json({ error: "Esta solicitud ya se cerró" }, { status: 409 });
  if (app.documents.length > 60) return Response.json({ error: "Demasiados archivos; avisa a RH" }, { status: 429 });
  const up = await readDocUpload(request);
  if ("error" in up) return Response.json({ error: up.error }, { status: up.status });
  try {
    const d = await addDocument(prisma, { applicationId: app.id, docType: up.docType, fileKey: up.key, fileName: up.fileName, mime: up.mime });
    return Response.json({ id: d.id });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "No se pudo guardar" }, { status: 400 });
  }
}
