import { employeeFile, prisma } from "@packatelas/db";
import { DocUploader } from "./doc-uploader";

/** Expediente propio: el empleado ve el estado y sube lo que falta o se rechazó [A22]. */
export async function MyDocuments({ userId }: { userId: string }) {
  const emp = await prisma.employee.findUnique({ where: { userId }, select: { id: true } });
  if (!emp) return null;
  const rows = await employeeFile(prisma, emp.id);
  const todo = rows.filter((r) => r.type.required && (!r.doc || r.doc.status === "RECHAZADO")).length;
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4">
      <h2 className="font-semibold">Mis documentos</h2>
      <p className="text-xs text-slate-500">{todo ? `Te falta${todo > 1 ? "n" : ""} ${todo}. Sube una foto clara o PDF.` : "Tu expediente está completo."}</p>
      <DocUploader
        endpoint="/api/docs/upload"
        rows={rows.map(({ type, doc }) => ({
          key: type.key, name: type.name, description: type.description, required: type.required,
          status: doc?.status ?? null, comment: doc?.comment ?? null, viewUrl: doc ? `/api/docs/${doc.fileKey}` : null,
        }))}
      />
    </section>
  );
}
