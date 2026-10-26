import "server-only";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import Docxtemplater from "docxtemplater";
import JSZip from "jszip";
import PizZip from "pizzip";
import {
  DESCRIPCION_ACTIVIDADES_REPARTIDOR, FRACCIONES, MESES, addDaysISO, daysBetweenInclusive, formatDateLong, joinSpanishList,
  money, montoEnLetraSinPesos, motivoTextos, numeroALetras, parseISODate, type Empresa, type TipoBaja,
} from "./rh-text";

export const BAJA_DOCS = ["constancia", "confidencialidad", "renuncia", "finiquito", "rescision"] as const;
export const INGRESO_DOCS = ["contrato", "anexo_a"] as const;
export type RhDoc = (typeof BAJA_DOCS)[number] | (typeof INGRESO_DOCS)[number];
const LABELS: Record<RhDoc, string> = {
  constancia: "Constancia_Laboral", confidencialidad: "Confidencialidad", renuncia: "Renuncia_Voluntaria", finiquito: "Finiquito",
  rescision: "Aviso_Rescision", contrato: "Contrato_Ingreso", anexo_a: "Anexo_A",
};

export type BajaInput = {
  nombre: string; curp?: string; rfc?: string; ident?: string; puesto?: string; ingreso: string; baja: string; ultimo?: string; salario: number;
  tipo: TipoBaja; fechaDocumento?: string;
  finiquito?: {
    hora?: string; fechaAviso?: string; periodo?: string; diasSal?: number; diasVac?: number; diasAgu?: number; horasExtra?: number;
    otrosConcepto?: string; otrosImporte?: number; deducciones?: { concepto: string; importe: number }[]; refPago?: string; excepciones?: string;
  };
  rescision?: { bienes?: string; causas?: { fraccion: string; narrativa: string }[] };
};
export type IngresoInput = {
  nombre: string; nacionalidad?: string; sexo?: string; fechaNacimiento?: string; estadoCivil?: string; curp?: string; rfc?: string; domicilio?: string; ident?: string;
  puesto?: string; esRepartidor: boolean; lugarPrestacion?: string; fechaInicio: string; salario: number; bono?: number; condicionesBono?: string;
  pruebaDias?: number | null; capacitacionDias?: number | null; motoPropia?: boolean; trasladoAutorizado?: boolean; actividadesAdicionales?: string;
  fechaFirma?: string; testigo1?: string; testigo2?: string;
};

const sanitize = (s: string) => (s || "documento").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "documento";
const up = (s?: string) => (s ?? "").trim().toUpperCase();

function templateDir() {
  const c = [path.join(process.cwd(), "rh-templates"), path.join(process.cwd(), "apps/web/rh-templates")];
  const d = c.find((p) => existsSync(p));
  if (!d) throw new Error("No se encontraron las plantillas de RH en el servidor");
  return d;
}

function render(doc: RhDoc, data: Record<string, unknown>): Buffer {
  const zip = new PizZip(readFileSync(path.join(templateDir(), `${doc}.docx`)));
  const d = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true, delimiters: { start: "[", end: "]" }, nullGetter: () => "" });
  try {
    d.render(data);
  } catch (e) {
    const errs = (e as { properties?: { errors?: { properties?: { explanation?: string } }[] } }).properties?.errors ?? [];
    throw new Error(errs.map((x) => x.properties?.explanation).filter(Boolean).join(" | ") || (e as Error).message);
  }
  return d.getZip().generate({ type: "nodebuffer" });
}

function finiquitoTotals(b: BajaInput) {
  const f = b.finiquito ?? {};
  const s = Number(b.salario) || 0;
  const impSal = (f.diasSal ?? 0) * s, impVac = (f.diasVac ?? 0) * s, impPrima = impVac * 0.25, impAgu = (f.diasAgu ?? 0) * s;
  const impHE = f.horasExtra ?? 0, otros = f.otrosImporte ?? 0;
  const perc = impSal + impVac + impPrima + impAgu + impHE + otros;
  const ded = (f.deducciones ?? []).reduce((a, d) => a + (Number(d.importe) || 0), 0);
  return { impSal, impVac, impPrima, impAgu, impHE, otros, perc, ded, neto: perc - ded };
}

function bajaData(doc: RhDoc, b: BajaInput) {
  const shared = {
    NOMBRE_DEL_EMPLEADO: up(b.nombre), CURP_EMPLEADO: up(b.curp), RFC_EMPLEADO: up(b.rfc), TIPO_Y_NUMERO_DE_IDENTIFICACION: b.ident ?? "",
    PUESTO: b.puesto ?? "", FECHA_DE_INICIO: formatDateLong(b.ingreso), FECHA_DE_BAJA: formatDateLong(b.baja),
    ULTIMO_DIA_LABORADO: formatDateLong(b.ultimo || b.baja), SALARIO_DIARIO: money(b.salario), ANTIGUEDAD_DIAS: String(daysBetweenInclusive(b.ingreso, b.baja)),
    FECHA_DOCUMENTO: formatDateLong(b.fechaDocumento || b.baja),
  };
  const m = motivoTextos(b.tipo, b.finiquito?.fechaAviso);
  if (doc === "constancia") return { ...shared, DIAS_LABORADOS: shared.ANTIGUEDAD_DIAS, SALARIO_MENSUAL: money(b.salario * 30) };
  if (doc === "confidencialidad") return { ...shared, MOTIVO_TERMINACION_TEXTO: m.confidencialidad };
  if (doc === "renuncia") return shared;
  if (doc === "finiquito") {
    const f = b.finiquito ?? {}, t = finiquitoTotals(b);
    const ded: Record<string, string> = {};
    for (let i = 0; i < 4; i++) {
      const d = f.deducciones?.[i];
      ded[`DEDUCCION_${i + 1}_CONCEPTO`] = d?.concepto || "—";
      ded[`DEDUCCION_${i + 1}_IMPORTE`] = d && (d.concepto || d.importe) ? money(d.importe) : "—";
    }
    return {
      ...shared, ...ded, HORA_DOCUMENTO: f.hora || "____", MOTIVO_TERMINACION_CORTO: m.corto, FUNDAMENTO_TERMINACION_TEXTO: m.fundamento,
      CLAUSULA_SEGUNDA_TITULO: m.segundaTitulo, CLAUSULA_SEGUNDA_TEXTO: m.segundaTexto, CANTIDAD_NETA_EN_LETRA: numeroALetras(t.neto),
      REFERENCIA_PAGO: f.refPago || "N/A", EXCEPCIONES_DEVOLUCION_BIENES: f.excepciones || "ninguna", PERIODO_SALARIO_DEVENGADO: f.periodo || "—",
      DIAS_SALARIO_DEVENGADO: String(f.diasSal ?? 0), IMPORTE_SALARIO_DEVENGADO: money(t.impSal), DIAS_VACACIONES_PROP: String(f.diasVac ?? 0),
      IMPORTE_VACACIONES_PROP: money(t.impVac), IMPORTE_PRIMA_VACACIONAL_PROP: money(t.impPrima), DIAS_AGUINALDO_PROP: String(f.diasAgu ?? 0),
      IMPORTE_AGUINALDO_PROP: money(t.impAgu), IMPORTE_HORAS_EXTRA: money(t.impHE), OTROS_PERCEPCION_CONCEPTO: f.otrosConcepto || "—",
      OTROS_PERCEPCION_IMPORTE: money(t.otros), TOTAL_PERCEPCIONES: money(t.perc), TOTAL_DEDUCCIONES: money(t.ded), NETO_A_PAGAR: money(t.neto),
    };
  }
  // rescisión
  const causas = (b.rescision?.causas ?? []).filter((c) => c.narrativa?.trim()).map((c, i) => {
    const label = c.fraccion.replace("_", "/");
    const def = FRACCIONES.find((f) => f[0] === c.fraccion);
    return { numero: i + 1, fraccion: label, titulo: `${def ? def[1] : ""} (art. 47, fr. ${label} LFT).`, narrativa: c.narrativa.trim() };
  });
  return {
    ...shared, BIENES_A_DEVOLVER: b.rescision?.bienes || "la motocicleta, herramientas, equipo, uniformes, gafete, dinero, paquetes y documentos",
    FRACCIONES_INVOCADAS: joinSpanishList(causas.map((c) => c.fraccion)) || "—", causas,
  };
}

function ingresoData(doc: RhDoc, e: Empresa, i: IngresoInput) {
  const base = { NOMBRE_O_RAZON_SOCIAL_PATRON: e.razonSocial, NOMBRE_REPRESENTANTE_LEGAL: e.repLegal, NOMBRE_DEL_EMPLEADO: up(i.nombre), PLAZO_ENTREGA_EFECTIVO: e.plazoEntregaEfectivo, ACTIVIDADES_ADICIONALES: i.actividadesAdicionales || "Ninguna actividad adicional específica por el momento." };
  if (doc === "anexo_a") return base;
  const nac = parseISODate(i.fechaNacimiento);
  let edad: number | null = null;
  if (nac) { const t = new Date(); edad = t.getUTCFullYear() - nac.getUTCFullYear() - (t.getUTCMonth() < nac.getUTCMonth() || (t.getUTCMonth() === nac.getUTCMonth() && t.getUTCDate() < nac.getUTCDate()) ? 1 : 0); }
  const firma = parseISODate(i.fechaFirma || i.fechaInicio);
  const fmt2 = (n: number) => n.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const tarifa = Number(e.tarifaKm) || 0;
  return {
    ...base,
    RFC_PATRON: up(e.rfc), DOMICILIO_PATRON: e.domicilio, TIPO_PERSONA_PATRON: e.tipoPersona, PERIODICIDAD_PAGO: e.periodicidad, DIAS_DE_PAGO: e.diasPago,
    LUGAR_DE_PAGO: e.lugarPago, LINEA_JORNADA: e.jornada, HORA_ENTRADA: e.horaEntrada, HORA_SALIDA: e.horaSalida, "DÍA_INICIO": e.diaInicio, "DÍA_FIN": e.diaFin,
    "DURACIÓN": e.descanso, DIAS_DE_DESCANSO: e.diasDescanso, MUNICIPIO_ESTADO_DE_MEXICO: e.lugarFirma, PLAZO_CONFIDENCIALIDAD: e.plazoConfidencialidad,
    PLAZO_NO_SOLICITACION: e.plazoNoSolicitacion, PLAZO_AVISO_RENUNCIA: e.plazoAvisoRenuncia, PLAZO_PAGO_FINIQUITO: e.plazoPagoFiniquito,
    PLAZO_ABANDONO: e.plazoAbandono, PLAZO_ENTREGA_INCAPACIDAD: e.plazoEntregaIncapacidad,
    NACIONALIDAD: i.nacionalidad ?? "", FECHA_NACIMIENTO_EDAD: nac ? `${formatDateLong(i.fechaNacimiento)}${edad != null ? ` (${edad} años)` : ""}` : "",
    SEXO: i.sexo ?? "", ESTADO_CIVIL: i.estadoCivil ?? "", CURP_EMPLEADO: up(i.curp), RFC_EMPLEADO: up(i.rfc), DOMICILIO_EMPLEADO: i.domicilio ?? "",
    TIPO_Y_NUMERO_DE_IDENTIFICACION: i.ident ?? "", PUESTO: i.puesto ?? "", esRepartidor: i.esRepartidor, showAnexoGenerico: false,
    DESCRIPCION_ACTIVIDADES: i.esRepartidor ? DESCRIPCION_ACTIVIDADES_REPARTIDOR : "Las propias de su puesto, conforme a las instrucciones de “EL PATRÓN” y al detalle que, en su caso, se desarrolle en un Anexo de actividades.",
    ACTIVIDADES_PUESTO_REDACTADO: "", LUGAR_PRESTACION_SERVICIO: i.lugarPrestacion ?? "", FECHA_DE_INICIO: formatDateLong(i.fechaInicio),
    LINEA_PERIODO_PRUEBA: i.pruebaDias ? `Sí — por ${i.pruebaDias} días naturales, concluyendo el ${formatDateLong(addDaysISO(i.fechaInicio, i.pruebaDias))}` : "No aplica.",
    LINEA_CAPACITACION: i.capacitacionDias ? `Sí — por ${i.capacitacionDias} días naturales, concluyendo el ${formatDateLong(addDaysISO(i.fechaInicio, i.capacitacionDias))}` : "No aplica.",
    MONTO_EN_NUMERO: fmt2(i.salario), MONTO_EN_LETRA: montoEnLetraSinPesos(i.salario),
    LINEA_BONO_PRODUCTIVIDAD: i.bono ? `$${fmt2(i.bono)} mensuales, sujeto al cumplimiento de las condiciones señaladas en la siguiente fila. Percepción variable, no garantizada ni exigible en los periodos en que no se cumplan dichas condiciones.` : "No aplica.",
    CONDICIONES_BONO_PRODUCTIVIDAD: i.bono ? i.condicionesBono || "A definir por “EL PATRÓN” y notificar por escrito a “EL TRABAJADOR”." : "No aplica.",
    LINEA_MOTO_PROPIEDAD: i.esRepartidor ? (i.motoPropia ? "Propia de “EL TRABAJADOR”" : "Proporcionada por “EL PATRÓN”") : "No aplica.",
    LINEA_TRASLADO_MOTO: i.esRepartidor ? (i.motoPropia ? (i.trasladoAutorizado === false ? "No autorizado" : "Autorizado") : "No aplica (motocicleta proporcionada por “EL PATRÓN”).") : "No aplica.",
    LINEA_REEMBOLSO_KM: i.esRepartidor && i.motoPropia && tarifa > 0 ? `$${tarifa.toFixed(2)} por kilómetro recorrido según el sistema de ruteo de “EL PATRÓN”.` : i.esRepartidor && i.motoPropia ? "A definir por “EL PATRÓN”." : "No aplica.",
    LINEA_COMBUSTIBLE: i.esRepartidor ? "Cubiertos por “EL PATRÓN”, independientemente de si la motocicleta utilizada es propia o proporcionada por “EL PATRÓN”." : "No aplica.",
    "DÍA": firma ? String(firma.getUTCDate()) : "", MES: firma ? MESES[firma.getUTCMonth()] : "", "AÑO": firma ? String(firma.getUTCFullYear()) : "",
    NOMBRE_TESTIGO_1: i.testigo1 ?? "", NOMBRE_TESTIGO_2: i.testigo2 ?? "",
  };
}

export function validateBaja(b: BajaInput) {
  const m: string[] = [];
  if (!b.nombre?.trim()) m.push("nombre del empleado");
  if (!parseISODate(b.ingreso)) m.push("fecha de ingreso");
  if (!parseISODate(b.baja)) m.push("fecha de baja");
  if (!(b.salario > 0)) m.push("salario diario");
  return m;
}

export function generateBaja(doc: (typeof BAJA_DOCS)[number], b: BajaInput) {
  return { filename: `${LABELS[doc]}_${sanitize(b.nombre)}.docx`, data: render(doc, bajaData(doc, b)) };
}
export function generateIngreso(doc: (typeof INGRESO_DOCS)[number], e: Empresa, i: IngresoInput) {
  return { filename: `${LABELS[doc]}_${sanitize(i.nombre)}.docx`, data: render(doc, ingresoData(doc, e, i)) };
}
export async function bajaPackage(b: BajaInput) {
  const docs = ["constancia", "confidencialidad", "finiquito", b.tipo === "despido" ? "rescision" : "renuncia"] as const;
  const zip = new JSZip();
  for (const d of docs) { const r = generateBaja(d, b); zip.file(r.filename, r.data); }
  return { filename: `Baja_${sanitize(b.nombre)}.zip`, data: await zip.generateAsync({ type: "nodebuffer" }) };
}
