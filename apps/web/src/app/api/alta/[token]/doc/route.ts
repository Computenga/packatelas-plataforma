import { addDocument, addToQuota, findApplication, isDocType, prisma, ymdMx } from "@packatelas/db";
import { readDocUpload, removeFiles, saveDocUpload } from "@/lib/doc-upload";

// Formulario público: cupos para que nadie pueda llenar el disco del servidor.
const MAX_UPLOADS_PER_APPLICATION = 40;
const MAX_PUBLIC_BYTES_PER_DAY = 600 * 1024 * 1024;

/** La persona en proceso de alta sube un documento con su enlace privado [A25]. */
export async function POST(request: Request, ctx: RouteContext<"/api/alta/[token]/doc">) {
  const app = await findApplication(prisma, (await ctx.params).token);
  if (!app) return Response.json({ error: "Enlace inválido" }, { status: 404 });
  if (app.status === "APROBADA" || app.status === "RECHAZADA") return Response.json({ error: "Esta solicitud ya se cerró" }, { status: 409 });
  const up = await readDocUpload(request);
  if ("error" in up) return Response.json({ error: up.error }, { status: up.status });
  if (!(await isDocType(prisma, up.docType))) return Response.json({ error: "Tipo de documento inválido" }, { status: 400 });

  const count = await addToQuota(prisma, `alta-uploads:${app.id}`, 1);
  if (count > MAX_UPLOADS_PER_APPLICATION) return Response.json({ error: "Demasiados archivos; avisa a RH" }, { status: 429 });
  const bytes = await addToQuota(prisma, `alta-bytes:${ymdMx(new Date())}`, up.buf.length);
  if (bytes > MAX_PUBLIC_BYTES_PER_DAY) return Response.json({ error: "Por hoy no se pueden subir más archivos; inténtalo mañana o avisa a RH" }, { status: 429 });

  const key = await saveDocUpload(up);
  try {
    const d = await addDocument(prisma, { applicationId: app.id, docType: up.docType, fileKey: key, fileName: up.fileName, mime: up.mime });
    await removeFiles(d.replacedKeys);
    return Response.json({ id: d.id });
  } catch (e) {
    await removeFiles([key]);
    return Response.json({ error: e instanceof Error ? e.message : "No se pudo guardar" }, { status: 400 });
  }
}
