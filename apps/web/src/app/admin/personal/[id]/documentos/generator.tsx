"use client";
import { useMemo, useState } from "react";
import { Button, Card, Field, Select } from "@/components/ui";
import { daysBetweenInclusive, money, suggestFiniquito, type TipoBaja } from "@/lib/rh-text";

type Emp = { nombre: string; curp: string; rfc: string; puesto: string; domicilio: string; ingreso: string; baja: string; salario: number; esRepartidor: boolean };
type Ded = { concepto: string; importe: number };

const BAJA_LABEL: Record<string, string> = {
  paquete: "Paquete completo (.zip)", constancia: "Constancia laboral", finiquito: "Finiquito", confidencialidad: "Carta de confidencialidad",
  renuncia: "Carta de renuncia", rescision: "Aviso de rescisión",
};

async function download(body: unknown, setMsg: (m: string) => void) {
  setMsg("Generando…");
  const res = await fetch("/api/rh/documento", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) {
    const j = (await res.json().catch(() => null)) as { error?: string } | null;
    setMsg(j?.error ?? "No se pudo generar");
    return;
  }
  const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? "documento.docx";
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  setMsg(`Descargado: ${name}`);
}

export function RhGenerator({ employeeId, emp, deducciones, fracciones, today }: { employeeId: string; emp: Emp; deducciones: Ded[]; fracciones: [string, string][]; today: string }) {
  const [tab, setTab] = useState<"ingreso" | "baja">(emp.baja ? "baja" : "ingreso");
  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {(["ingreso", "baja"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`rounded-lg px-4 py-2 text-sm font-medium ${tab === t ? "bg-brand text-white" : "border border-slate-300 bg-white"}`}>
            {t === "ingreso" ? "Ingreso (contrato)" : "Baja"}
          </button>
        ))}
      </div>
      {tab === "ingreso" ? <Ingreso employeeId={employeeId} emp={emp} today={today} /> : <Baja employeeId={employeeId} emp={emp} deducciones={deducciones} fracciones={fracciones} today={today} />}
    </div>
  );
}

function Ingreso({ employeeId, emp, today }: { employeeId: string; emp: Emp; today: string }) {
  const [msg, setMsg] = useState("");
  function submit(doc: string, form: HTMLFormElement) {
    const f = new FormData(form);
    const s = (k: string) => String(f.get(k) ?? "").trim();
    const n = (k: string) => (s(k) ? Number(s(k)) : null);
    void download({
      kind: "ingreso", doc, employeeId,
      input: {
        nombre: s("nombre"), nacionalidad: s("nacionalidad"), sexo: s("sexo"), fechaNacimiento: s("fechaNacimiento"), estadoCivil: s("estadoCivil"),
        curp: s("curp"), rfc: s("rfc"), domicilio: s("domicilio"), ident: s("ident"), puesto: s("puesto"), esRepartidor: f.get("esRepartidor") === "on",
        lugarPrestacion: s("lugarPrestacion"), fechaInicio: s("fechaInicio"), salario: Number(s("salario")) || 0, bono: n("bono") ?? 0,
        condicionesBono: s("condicionesBono"), pruebaDias: n("pruebaDias"), capacitacionDias: n("capacitacionDias"),
        motoPropia: f.get("motoPropia") === "on", trasladoAutorizado: f.get("trasladoAutorizado") === "on", actividadesAdicionales: s("actividadesAdicionales"),
        fechaFirma: s("fechaFirma"), testigo1: s("testigo1"), testigo2: s("testigo2"),
      },
    }, setMsg);
  }
  return (
    <Card title="Contrato individual de trabajo">
      <form id="rh-ingreso" onSubmit={(ev) => { ev.preventDefault(); submit("contrato", ev.currentTarget); }} className="grid gap-3 sm:grid-cols-2">
        <Field name="nombre" label="Nombre completo" defaultValue={emp.nombre} required />
        <Field name="puesto" label="Puesto" defaultValue={emp.puesto} />
        <Field name="curp" label="CURP" defaultValue={emp.curp} />
        <Field name="rfc" label="RFC" defaultValue={emp.rfc} />
        <Field name="domicilio" label="Domicilio" defaultValue={emp.domicilio} className="sm:col-span-2" />
        <Field name="nacionalidad" label="Nacionalidad" defaultValue="Mexicana" />
        <Select name="sexo" label="Sexo" defaultValue=""><option value="">—</option><option>Masculino</option><option>Femenino</option></Select>
        <Field name="fechaNacimiento" label="Fecha de nacimiento" type="date" />
        <Select name="estadoCivil" label="Estado civil" defaultValue=""><option value="">—</option><option>Soltero(a)</option><option>Casado(a)</option><option>Unión libre</option><option>Divorciado(a)</option><option>Viudo(a)</option></Select>
        <Field name="ident" label="Identificación (tipo y número)" placeholder="INE 1234567890" />
        <Field name="lugarPrestacion" label="Lugar de prestación" defaultValue={emp.esRepartidor ? "Rutas asignadas en CDMX y Estado de México" : "Juan Lucas de Lassaga 54, Obrera, CDMX"} />
        <Field name="fechaInicio" label="Fecha de inicio" type="date" defaultValue={emp.ingreso || today} required />
        <Field name="salario" label="Salario por quincena" type="number" step="0.01" min="0" defaultValue={emp.salario ? (emp.salario * 15).toFixed(2) : ""} hint={emp.salario ? `Salario diario ${money(emp.salario)} × 15` : undefined} required />
        <Field name="bono" label="Bono mensual (opcional)" type="number" step="0.01" min="0" />
        <Field name="condicionesBono" label="Condiciones del bono" />
        <Field name="pruebaDias" label="Periodo de prueba (días)" type="number" min="0" max="180" />
        <Field name="capacitacionDias" label="Capacitación inicial (días)" type="number" min="0" max="180" hint="Excluyente del periodo de prueba" />
        <Field name="actividadesAdicionales" label="Actividades adicionales" className="sm:col-span-2" />
        <Field name="fechaFirma" label="Fecha de firma" type="date" defaultValue={today} />
        <div />
        <Field name="testigo1" label="Testigo 1" />
        <Field name="testigo2" label="Testigo 2" />
        <div className="flex flex-wrap gap-4 text-sm sm:col-span-2">
          <label className="flex items-center gap-2"><input type="checkbox" name="esRepartidor" defaultChecked={emp.esRepartidor} /> Es repartidor</label>
          <label className="flex items-center gap-2"><input type="checkbox" name="motoPropia" /> Moto propia</label>
          <label className="flex items-center gap-2"><input type="checkbox" name="trasladoAutorizado" /> Traslado a otras zonas autorizado</label>
        </div>
        <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
          <Button>Descargar contrato</Button>
          <Button type="button" variant="secondary" onClick={(ev) => submit("anexo_a", ev.currentTarget.form!)}>Descargar Anexo A</Button>
          {msg && <span className="text-sm text-slate-600">{msg}</span>}
        </div>
      </form>
    </Card>
  );
}

function Baja({ employeeId, emp, deducciones, fracciones, today }: { employeeId: string; emp: Emp; deducciones: Ded[]; fracciones: [string, string][]; today: string }) {
  const [msg, setMsg] = useState("");
  const [tipo, setTipo] = useState<TipoBaja>("renuncia");
  const [ingreso, setIngreso] = useState(emp.ingreso);
  const [baja, setBaja] = useState(emp.baja || today);
  const [causas, setCausas] = useState<Record<string, string>>({});
  const [deds, setDeds] = useState<Ded[]>(deducciones);
  const sug = useMemo(() => (ingreso && baja ? suggestFiniquito(ingreso, baja) : null), [ingreso, baja]);
  const antig = ingreso && baja ? daysBetweenInclusive(ingreso, baja) : 0;
  // Días de salario devengado: desde el inicio de la quincena de la baja.
  const diasSal = baja ? Math.min(Number(baja.slice(8, 10)) - (Number(baja.slice(8, 10)) > 15 ? 15 : 0), 15) : 0;
  const docs = ["paquete", "constancia", "finiquito", "confidencialidad", tipo === "despido" ? "rescision" : "renuncia"];

  function submit(doc: string, form: HTMLFormElement) {
    const f = new FormData(form);
    const s = (k: string) => String(f.get(k) ?? "").trim();
    const num = (k: string) => Number(s(k)) || 0;
    void download({
      kind: "baja", doc, employeeId,
      input: {
        nombre: s("nombre"), curp: s("curp"), rfc: s("rfc"), ident: s("ident"), puesto: s("puesto"), ingreso, baja, ultimo: s("ultimo"),
        salario: num("salario"), tipo, fechaDocumento: s("fechaDocumento"),
        finiquito: {
          hora: s("hora"), fechaAviso: s("fechaAviso"), periodo: s("periodo"), diasSal: num("diasSal"), diasVac: num("diasVac"), diasAgu: num("diasAgu"),
          horasExtra: num("horasExtra"), otrosConcepto: s("otrosConcepto"), otrosImporte: num("otrosImporte"),
          deducciones: deds.filter((d) => d.concepto && d.importe > 0), refPago: s("refPago"), excepciones: s("excepciones"),
        },
        rescision: tipo === "despido" ? { bienes: s("bienes"), causas: Object.entries(causas).filter(([, v]) => v.trim()).map(([fraccion, narrativa]) => ({ fraccion, narrativa })) } : undefined,
      },
    }, setMsg);
  }

  return (
    <form onSubmit={(ev) => ev.preventDefault()} className="space-y-4">
      <Card title="Datos de la baja">
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label="Tipo de baja" value={tipo} onChange={(ev) => setTipo(ev.target.value as TipoBaja)}>
            <option value="renuncia">Renuncia voluntaria</option><option value="mutuo">Mutuo acuerdo</option><option value="despido">Rescisión (despido justificado)</option>
          </Select>
          <Field name="nombre" label="Nombre completo" defaultValue={emp.nombre} required />
          <Field name="puesto" label="Puesto" defaultValue={emp.puesto} />
          <Field name="ident" label="Identificación (tipo y número)" placeholder="INE 1234567890" />
          <Field name="curp" label="CURP" defaultValue={emp.curp} />
          <Field name="rfc" label="RFC" defaultValue={emp.rfc} />
          <Field label="Fecha de ingreso" type="date" value={ingreso} onChange={(ev) => setIngreso(ev.target.value)} required />
          <Field label="Fecha de baja" type="date" value={baja} onChange={(ev) => setBaja(ev.target.value)} required hint={antig ? `Antigüedad: ${antig} días` : undefined} />
          <Field name="ultimo" label="Último día laborado" type="date" defaultValue={baja} />
          <Field name="salario" label="Salario diario" type="number" step="0.01" min="0" defaultValue={emp.salario || ""} required />
          <Field name="fechaDocumento" label="Fecha de los documentos" type="date" defaultValue={today} />
          {tipo !== "despido" && <Field name="fechaAviso" label="Fecha del aviso de renuncia" type="date" defaultValue={today} />}
        </div>
      </Card>

      <Card title="Finiquito">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field name="periodo" label="Periodo de salario devengado" placeholder="16 al 25 de octubre de 2026" className="sm:col-span-3" />
          <Field key={`s${baja}`} name="diasSal" label="Días de salario pendientes" type="number" step="0.01" min="0" defaultValue={diasSal} />
          <Field key={`v${sug?.vacDays}`} name="diasVac" label="Días de vacaciones prop." type="number" step="0.01" min="0" defaultValue={sug?.vacDays ?? 0} hint="Sugerido por antigüedad (LFT 2023)" />
          <Field key={`a${sug?.aguDays}`} name="diasAgu" label="Días de aguinaldo prop." type="number" step="0.01" min="0" defaultValue={sug?.aguDays ?? 0} hint="15 días al año" />
          <Field name="horasExtra" label="Horas extra (importe)" type="number" step="0.01" min="0" />
          <Field name="otrosConcepto" label="Otro concepto" />
          <Field name="otrosImporte" label="Importe otro concepto" type="number" step="0.01" min="0" />
          <Field name="hora" label="Hora de firma" type="time" defaultValue="18:00" />
          <Field name="refPago" label="Referencia de pago" />
          <Field name="excepciones" label="Bienes no devueltos" placeholder="ninguna" />
        </div>
        <div className="mt-4 space-y-2">
          <p className="text-sm font-medium text-slate-700">Deducciones {deducciones.length > 0 && <span className="font-normal text-slate-500">(adeudos pendientes del empleado precargados)</span>}</p>
          {deds.map((d, i) => (
            <div key={i} className="flex gap-2">
              <input aria-label="Concepto" className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" value={d.concepto} onChange={(ev) => setDeds(deds.map((x, j) => (j === i ? { ...x, concepto: ev.target.value } : x)))} />
              <input aria-label="Importe" type="number" step="0.01" className="w-32 rounded-lg border border-slate-300 px-3 py-2 text-sm" value={d.importe || ""} onChange={(ev) => setDeds(deds.map((x, j) => (j === i ? { ...x, importe: Number(ev.target.value) || 0 } : x)))} />
              <button type="button" className="px-2 text-sm text-red-600" onClick={() => setDeds(deds.filter((_, j) => j !== i))}>Quitar</button>
            </div>
          ))}
          <button type="button" className="text-sm text-brand" onClick={() => setDeds([...deds, { concepto: "", importe: 0 }])}>+ Agregar deducción</button>
        </div>
      </Card>

      {tipo === "despido" && (
        <Card title="Causas de rescisión (Art. 47 LFT)">
          <p className="mb-3 text-sm text-slate-500">Describe los hechos de cada causa que aplique: fecha, hora, lugar y qué ocurrió. Deja vacías las que no apliquen.</p>
          <div className="space-y-3">
            {fracciones.map(([fr, label]) => (
              <label key={fr} className="block">
                <span className="text-sm font-medium text-slate-700">Fracc. {fr.replace("_", " y ")} — {label}</span>
                <textarea rows={causas[fr] ? 3 : 1} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" value={causas[fr] ?? ""} onChange={(ev) => setCausas({ ...causas, [fr]: ev.target.value })} />
              </label>
            ))}
            <Field name="bienes" label="Bienes de la empresa a devolver" placeholder="Motocicleta, celular, uniforme…" />
          </div>
        </Card>
      )}

      <Card title="Descargar">
        <div className="flex flex-wrap items-center gap-2">
          {docs.map((d) => (
            <Button key={d} type="button" variant={d === "paquete" ? "primary" : "secondary"} onClick={(ev) => submit(d, ev.currentTarget.form!)}>{BAJA_LABEL[d]}</Button>
          ))}
        </div>
        {msg && <p className="mt-3 text-sm text-slate-600">{msg}</p>}
      </Card>
    </form>
  );
}
