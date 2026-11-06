import { driverDuplicateCases, prisma } from "@packatelas/db";
import { fecha } from "@/lib/format";
import { Badge, Card } from "@/components/ui";
import { keepAutoAction, mergeDriverAction } from "./driver-review-actions";

/** Altas automáticas de repartidores: números por registrar en el checador y posibles usuarios duplicados. */
export async function DriverReview() {
  const [cases, pending] = await Promise.all([
    driverDuplicateCases(prisma),
    prisma.employee.findMany({
      where: { notes: { contains: "Falta registrar su huella" }, punches: { none: {} } },
      select: { employeeNo: true, name: true, user: { select: { username: true } } },
      orderBy: { employeeNo: "asc" },
    }),
  ]);
  if (!cases.length && !pending.length) return null;
  const dup = new Set(cases.map((c) => c.autoNo));
  return (
    <div className="space-y-4">
      {cases.length > 0 && (
        <Card title={`Posible misma persona con dos usuarios (${cases.length})`}>
          <p className="mb-3 text-sm text-slate-600">
            Al dar de alta su empleado encontré otro empleado con el mismo nombre o teléfono que ya usa otro usuario. Si es la misma persona, elige con qué usuario se queda:
            el número creado de más se borra y el otro usuario se desactiva. Si son personas distintas, toca «Es otra persona».
          </p>
          <ul className="divide-y divide-slate-100 text-sm">
            {cases.map((c) => (
              <li key={c.autoId} className="space-y-2 py-3">
                <p>
                  <strong>#{c.autoNo} {c.user}</strong> <span className="font-mono text-xs text-slate-500">({c.username})</span>
                  <span className="text-xs text-slate-500"> · última actividad {c.lastSeen ? fecha(c.lastSeen) : "nunca"}</span>
                </p>
                {c.others.map((o) => (
                  <div key={o.employeeId} className="ml-4 flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-2">
                    <span>parece <strong>#{o.employeeNo} {o.name}</strong> {o.status !== "ACTIVO" && <Badge>Baja</Badge>}</span>
                    <span className="text-xs text-slate-500">{o.username ? `usuario ${o.username} · última actividad ${o.lastSeen ? fecha(o.lastSeen) : "nunca"}` : "sin usuario"}</span>
                    <form action={mergeDriverAction.bind(null, c.autoId, o.employeeId, c.userId)}>
                      <button className="rounded border border-brand px-2 py-1 text-xs font-semibold text-brand">Misma persona: queda #{o.employeeNo} con {c.username}</button>
                    </form>
                    {o.userId && o.userId !== c.userId && (
                      <form action={mergeDriverAction.bind(null, c.autoId, o.employeeId, o.userId)}>
                        <button className="rounded border border-brand px-2 py-1 text-xs font-semibold text-brand">Misma persona: queda #{o.employeeNo} con {o.username}</button>
                      </form>
                    )}
                  </div>
                ))}
                <form action={keepAutoAction.bind(null, c.autoId)} className="ml-4"><button className="text-xs text-slate-600 underline">Es otra persona: dejar #{c.autoNo}</button></form>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {pending.length > 0 && (
        <Card title={`Por registrar huella en el checador (${pending.length})`}>
          <p className="mb-2 text-sm text-slate-600">Empleados creados solos para repartidores. Regístrales su huella en el ZKTeco con este número; al llegar su primera checada desaparecen de aquí.</p>
          <ul className="grid gap-1 text-sm sm:grid-cols-2">
            {pending.map((p) => (
              <li key={p.employeeNo} className={dup.has(p.employeeNo) ? "text-slate-400" : ""}>
                <span className="font-mono font-semibold">#{p.employeeNo}</span> {p.name} {p.user && <span className="font-mono text-xs text-slate-500">({p.user.username})</span>}
                {dup.has(p.employeeNo) && <span className="text-xs"> · revisa arriba antes</span>}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
