import Link from "next/link";
import { missingFiscal, prisma } from "@packatelas/db";

/**
 * Primeros pasos del portal cliente: lo que le falta a la tienda para operar con la plataforma
 * nueva (sobre todo, volver a conectar sus cuentas de Mercado Libre). Desaparece cuando todo está listo.
 */
export async function ClientOnboarding({ clientId }: { clientId: string }) {
  const c = await prisma.client.findUnique({
    where: { id: clientId },
    select: {
      paymentReference: true, rfc: true, legalName: true, taxRegime: true, taxZip: true, cfdiUse: true, email: true, phone: true,
      mlAccounts: { select: { id: true, nickname: true, status: true, accessTokenEnc: true }, orderBy: { nickname: "asc" } },
    },
  });
  if (!c) return null;
  const connected = (a: (typeof c.mlAccounts)[number]) => a.status === "ACTIVE" && !!a.accessTokenEnc;
  const pendingMl = c.mlAccounts.filter((a) => !connected(a));
  const fiscal = missingFiscal(c);
  const steps = [
    {
      key: "ml",
      done: c.mlAccounts.length > 0 && pendingMl.length === 0,
      title: c.mlAccounts.length ? "Vuelve a conectar tus cuentas de Mercado Libre" : "Conecta tu cuenta de Mercado Libre (si vendes ahí)",
      body: c.mlAccounts.length ? (
        <>
          Con la plataforma nueva cada cuenta se autoriza otra vez. Sin esto, cuando escaneamos tu paquete no vemos la dirección y puede retrasarse la entrega.
          <span className="mt-1 flex flex-wrap gap-1.5">
            {c.mlAccounts.map((a) => (
              <span key={a.id} className={`rounded-full px-2 py-0.5 text-xs ${connected(a) ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-900"}`}>
                {connected(a) ? "✓" : "Pendiente:"} {a.nickname}
              </span>
            ))}
          </span>
        </>
      ) : (
        "Así, cuando escaneamos tu paquete, el envío aparece con destinatario y dirección."
      ),
      href: "/cliente/mercadolibre",
      cta: pendingMl.length || !c.mlAccounts.length ? "Conectar" : "Ver",
      required: c.mlAccounts.length > 0,
    },
    {
      key: "fiscal",
      done: fiscal.length === 0,
      title: "Captura tus datos fiscales",
      body: fiscal.length ? `Para facturar tus pagos falta: ${fiscal.join(", ")}. Cópialos de tu Constancia de Situación Fiscal.` : "Listo para facturar.",
      href: "/cliente/facturas",
      cta: "Capturar",
      required: false,
    },
  ];
  const pending = steps.filter((s) => !s.done && (s.required || s.key === "fiscal"));
  if (!pending.length) return null;
  const doneCount = steps.filter((s) => s.done).length;

  return (
    <section className="rounded-xl border border-brand/20 bg-white p-4 shadow-sm">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-semibold">Bienvenido a la plataforma nueva de Packatelas</h2>
        <span className="text-xs text-slate-500">
          {doneCount} de {steps.length} listos
        </span>
      </div>
      <p className="mt-1 text-sm text-slate-600">
        Te faltan estos pasos. Tu referencia para pagar por transferencia es <strong className="font-mono">{c.paymentReference}</strong> (la ves siempre en Estado de cuenta).
      </p>
      <ol className="mt-3 space-y-2">
        {steps.map((s, i) => (
          <li key={s.key} className={`flex flex-wrap items-start gap-3 rounded-lg border px-3 py-2 ${s.done ? "border-emerald-200 bg-emerald-50/50" : "border-amber-200 bg-amber-50/40"}`}>
            <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${s.done ? "bg-emerald-600 text-white" : "bg-amber-500 text-white"}`}>{s.done ? "✓" : i + 1}</span>
            <span className="min-w-0 flex-1 basis-48 text-sm">
              <span className="block font-medium">{s.title}</span>
              <span className="block text-slate-600">{s.body}</span>
            </span>
            {!s.done && (
              <Link href={s.href} className="ml-9 shrink-0 rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white sm:ml-0">
                {s.cta}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
