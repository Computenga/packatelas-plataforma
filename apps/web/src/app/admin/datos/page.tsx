import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { readRange } from "@/lib/report-range";
import { Card, PageHeader } from "@/components/ui";
import { RangeForm } from "../informes/range-form";

export const metadata: Metadata = { title: "Importar y exportar" };

const IMPORTS = [
  { href: "/admin/clientes/importar", label: "Clientes", hint: "Pegar o subir el listado del sistema actual (ID cmx/emx, tarifas, saldos)." },
  { href: "/admin/clientes/importar-ml", label: "Cuentas de MercadoLibre", hint: "Ligar cuentas ML a su cliente y sucursal." },
  { href: "/admin/pedidos/carga", label: "Pedidos (carga masiva)", hint: "Hasta 500 envíos por archivo, con ubicación automática." },
  { href: "/admin/personal/importar", label: "Personal", hint: "Base maestra del RH o del checador (sin PIN)." },
  { href: "/admin/checador", label: "Checadas", hint: "Pestaña Checadas o CSV del ZKTeco, sin duplicar." },
  { href: "/mecanico/motos", label: "Motos de la flotilla", hint: "Pestaña Vehiculos de la app actual." },
];

/** Todo lo que entra y sale del sistema en un solo lugar [I11]. */
export default async function DatosPage({ searchParams }: PageProps<"/admin/datos">) {
  await requireUser(["ADMIN"]);
  const { fromYmd, toYmd } = readRange(await searchParams);
  const q = (tipo: string, ranged = true) => `/admin/datos/exportar?${new URLSearchParams(ranged ? { tipo, from: fromYmd, to: toYmd } : { tipo })}`;
  const EXPORTS = [
    { href: q("clientes", false), label: "Clientes con saldo", hint: "Mismo formato que el importador de clientes." },
    { href: q("personal", false), label: "Personal", hint: "Mismo formato que el importador de personal." },
    { href: `/admin/pedidos/exportar?${new URLSearchParams({ from: fromYmd, to: toYmd })}`, label: "Envíos", hint: "Con estado, repartidor y fechas." },
    { href: q("movimientos"), label: "Movimientos de saldo", hint: "Cargos, abonos, comisiones y ajustes." },
    { href: q("pagos"), label: "Pagos recibidos", hint: "Depósitos identificados y sin identificar." },
    { href: q("recolecciones"), label: "Recolecciones", hint: "Programadas, recolectadas y bloqueadas." },
    { href: q("devoluciones"), label: "Devoluciones", hint: "Cadena de custodia bodega → vendedor." },
    { href: `/admin/cobros/antiguedad/exportar`, label: "Antigüedad de saldos", hint: "Reporte de cobranza al día." },
    { href: `/admin/informes/exportar?${new URLSearchParams({ from: fromYmd, to: toYmd })}`, label: "Desempeño de repartidores", hint: "Entregas, efectividad y horario extra." },
  ];
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader eyebrow="Gestión" title="Importar y exportar">Archivos CSV que abren en Excel o Google Sheets. Las exportaciones quedan en auditoría.</PageHeader>
      <Card title="Exportar">
        <div className="mb-4"><RangeForm base="/admin/datos" fromYmd={fromYmd} toYmd={toYmd} /></div>
        <p className="mb-3 text-xs text-slate-500">El periodo aplica a envíos, movimientos, pagos, recolecciones, devoluciones y desempeño.</p>
        <ul className="grid gap-3 sm:grid-cols-2">
          {EXPORTS.map((e) => (
            <li key={e.label} className="rounded-lg border border-slate-200 p-3">
              <a href={e.href} className="font-medium text-brand hover:underline">{e.label} ↓</a>
              <p className="text-xs text-slate-500">{e.hint}</p>
            </li>
          ))}
        </ul>
      </Card>
      <Card title="Importar">
        <ul className="grid gap-3 sm:grid-cols-2">
          {IMPORTS.map((i) => (
            <li key={i.label} className="rounded-lg border border-slate-200 p-3">
              <Link href={i.href} className="font-medium text-brand hover:underline">{i.label} →</Link>
              <p className="text-xs text-slate-500">{i.hint}</p>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
