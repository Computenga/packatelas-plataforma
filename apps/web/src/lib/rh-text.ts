// Textos y cálculos del Generador de Documentos RH (portados tal cual del generador de Computenga).
// Sin dependencias: se usa en el servidor y en el navegador (vista previa del finiquito).
export const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

export function parseISODate(s?: string | null) {
  if (!s) return null;
  const p = s.split("-");
  if (p.length !== 3) return null;
  return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
}
export function formatDateLong(iso?: string | null) {
  const d = parseISODate(iso);
  return d ? `${d.getUTCDate()} de ${MESES[d.getUTCMonth()]} de ${d.getUTCFullYear()}` : "";
}
export function daysBetweenInclusive(a?: string | null, b?: string | null) {
  const x = parseISODate(a), y = parseISODate(b);
  if (!x || !y) return 0;
  const diff = Math.round((y.getTime() - x.getTime()) / 86400000) + 1;
  return diff > 0 ? diff : 0;
}
export const money = (n: number) => (Number(n) || 0).toLocaleString("es-MX", { style: "currency", currency: "MXN" });
export function addDaysISO(iso: string, days: number) {
  const d = parseISODate(iso);
  if (!d) return "";
  d.setUTCDate(d.getUTCDate() + Number(days || 0));
  return d.toISOString().slice(0, 10);
}
export function joinSpanishList(items: string[]) {
  const u = items.filter(Boolean).filter((v, i, a) => a.indexOf(v) === i);
  if (!u.length) return "";
  return u.length === 1 ? u[0] : `${u.slice(0, -1).join(", ")} y ${u[u.length - 1]}`;
}

const UNIDADES = ["", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve"];
const DECENAS = ["diez", "once", "doce", "trece", "catorce", "quince", "dieciséis", "diecisiete", "dieciocho", "diecinueve",
  "veinte", "veintiuno", "veintidós", "veintitrés", "veinticuatro", "veinticinco", "veintiséis", "veintisiete", "veintiocho", "veintinueve"];
const DECENAS2 = ["", "", "", "treinta", "cuarenta", "cincuenta", "sesenta", "setenta", "ochenta", "noventa"];
const CENTENAS = ["", "ciento", "doscientos", "trescientos", "cuatrocientos", "quinientos", "seiscientos", "setecientos", "ochocientos", "novecientos"];
function tres(n: number) {
  if (n === 0) return "";
  if (n === 100) return "cien";
  const c = Math.floor(n / 100), r = n % 100, out: string[] = [];
  if (c > 0) out.push(CENTENAS[c]);
  if (r > 0) {
    if (r < 10) out.push(UNIDADES[r]);
    else if (r < 30) out.push(DECENAS[r - 10]);
    else { const d = Math.floor(r / 10), u = r % 10; out.push(DECENAS2[d] + (u > 0 ? ` y ${UNIDADES[u]}` : "")); }
  }
  return out.join(" ");
}
function enteros(n: number) {
  if (n === 0) return "cero";
  const mill = Math.floor(n / 1e6), miles = Math.floor((n % 1e6) / 1000), resto = n % 1000, out: string[] = [];
  if (mill > 0) out.push(mill === 1 ? "un millón" : `${tres(mill)} millones`);
  if (miles > 0) out.push(miles === 1 ? "mil" : `${tres(miles)} mil`);
  if (resto > 0 || !out.length) out.push(tres(resto));
  return out.join(" ").trim();
}
const apocope = (s: string) => s.replace(/\buno$/, "un").replace(/veintiuno$/, "veintiún");
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
export function numeroALetras(amount: number) {
  amount = Math.round((Number(amount) || 0) * 100) / 100;
  const e = Math.floor(amount), c = Math.round((amount - e) * 100);
  return `${cap(apocope(enteros(e)))} ${e === 1 ? "peso" : "pesos"} ${String(c).padStart(2, "0")}/100 M.N.`;
}
export const montoEnLetraSinPesos = (amount: number) => cap(apocope(enteros(Math.round(Number(amount) || 0))));

/** Art. 76 LFT ("vacaciones dignas" 2023). */
export function vacationDaysForYear(y: number) {
  if (y <= 1) return 12;
  if (y === 2) return 14;
  if (y === 3) return 16;
  if (y === 4) return 18;
  return 20 + Math.floor((y - 5) / 5) * 2;
}
/** Sugerencia de días de vacaciones y aguinaldo proporcionales. */
export function suggestFiniquito(ingreso: string, baja: string) {
  const total = daysBetweenInclusive(ingreso, baja);
  if (total <= 0) return null;
  const years = Math.floor(total / 365);
  const vac = Math.round(((total - years * 365) / 365) * vacationDaysForYear(years + 1) * 100) / 100;
  const b = parseISODate(baja)!, i = parseISODate(ingreso)!;
  const jan1 = new Date(Date.UTC(b.getUTCFullYear(), 0, 1));
  const start = i > jan1 ? i : jan1;
  const daysYear = Math.round((b.getTime() - start.getTime()) / 86400000) + 1;
  return { vacDays: vac, aguDays: Math.round((Math.max(daysYear, 0) / 365) * 15 * 100) / 100 };
}

export type TipoBaja = "renuncia" | "despido" | "mutuo";
export function motivoTextos(tipo: TipoBaja, fechaAviso?: string) {
  if (tipo === "despido") return {
    confidencialidad: "por rescisión de la relación de trabajo sin responsabilidad para EL PATRÓN",
    corto: "rescisión de la relación de trabajo sin responsabilidad para EL PATRÓN",
    fundamento: `notificada mediante el Aviso de Rescisión de fecha ${formatDateLong(fechaAviso) || "[FECHA_AVISO]"}, con fundamento en el artículo 47 de la Ley Federal del Trabajo`,
    segundaTitulo: "SEGUNDA. Rescisión con causa. ",
    segundaTexto: "La terminación de la relación de trabajo derivó de la rescisión notificada por EL PATRÓN mediante el Aviso de Rescisión señalado en la cláusula anterior, por las causas ahí descritas, lo que no exime a EL PATRÓN de cubrir las prestaciones devengadas que se detallan en el presente convenio, ni implica que EL TRABAJADOR renuncie a su derecho a controvertir la rescisión ante la autoridad laboral competente.",
  };
  if (tipo === "mutuo") return {
    confidencialidad: "por mutuo acuerdo entre las partes",
    corto: "mutuo acuerdo entre las partes",
    fundamento: "con fundamento en el artículo 53, fracción I de la Ley Federal del Trabajo",
    segundaTitulo: "SEGUNDA. Mutuo acuerdo. ",
    segundaTexto: "Ambas partes manifiestan su conformidad en dar por terminada la relación de trabajo por mutuo acuerdo, sin que medie presión, coacción ni amenaza alguna entre ellas, reconociendo cada una la validez del presente convenio.",
  };
  return {
    confidencialidad: "por renuncia voluntaria",
    corto: "renuncia voluntaria",
    fundamento: "de EL TRABAJADOR, presentada por escrito, con fundamento en el artículo 53, fracción I de la Ley Federal del Trabajo",
    segundaTitulo: "SEGUNDA. Voluntad de la renuncia. ",
    segundaTexto: "EL TRABAJADOR manifiesta que la terminación de la relación de trabajo obedece exclusivamente a su decisión personal, y que presentó su renuncia de manera libre y voluntaria, sin que mediara presión, coacción, amenaza ni despido alguno por parte de EL PATRÓN o de sus representantes.",
  };
}

export const FRACCIONES: [string, string][] = [
  ["II", "Falta de probidad u honradez, actos de violencia, amagos, injurias o malos tratos"],
  ["III", "Actos contra compañeros que alteren gravemente la disciplina del lugar de trabajo"],
  ["V_VI", "Perjuicios materiales intencionales o por negligencia grave"],
  ["VII", "Comprometer, por imprudencia o descuido inexcusable, la seguridad del centro de trabajo"],
  ["VIII", "Actos inmorales u hostigamiento y/o acoso sexual"],
  ["IX", "Revelar secretos industriales o comerciales"],
  ["X", "Más de tres faltas de asistencia injustificadas en un periodo de treinta días"],
  ["XI", "Desobedecer al patrón sin causa justificada"],
  ["XII", "Negarse a adoptar medidas preventivas de seguridad e higiene"],
  ["XIII", "Concurrir al trabajo en estado de embriaguez o bajo el influjo de drogas o narcóticos"],
  ["XIV", "Sentencia ejecutoriada que imponga pena de prisión"],
  ["XIV Bis", "Falta de documentos exigidos por leyes y reglamentos, imputable al trabajador"],
  ["XV", "Causas análogas de igual gravedad"],
];

export const EMPRESA_DEFAULT = {
  razonSocial: "Comercializadora Computenga, S.A. de C.V.", rfc: "CCO200608546", tipoPersona: "moral",
  domicilio: "Juan Lucas de Lassaga 54-Piso 1, Obrera, Cuauhtémoc, 06800 Ciudad de México, CDMX",
  repLegal: "Cristhian Michel Guevara Padilla", lugarFirma: "Cuauhtémoc, CDMX", periodicidad: "quincenal",
  diasPago: "Día 15 y día último de cada mes", lugarPago: "transferencia bancaria a la cuenta registrada por “EL TRABAJADOR”",
  jornada: "Diurna", horaEntrada: "09:00", horaSalida: "18:00", descanso: "30 minutos", diaInicio: "lunes", diaFin: "sábado",
  diasDescanso: "Domingo", tarifaKm: "", plazoConfidencialidad: "2 (dos) años", plazoNoSolicitacion: "1 (un) año",
  plazoAvisoRenuncia: "8 (ocho) días naturales", plazoPagoFiniquito: "15 (quince) días naturales", plazoAbandono: "3 (tres) días hábiles",
  plazoEntregaIncapacidad: "48 (cuarenta y ocho) horas", plazoEntregaEfectivo: "24 (veinticuatro) horas",
};
export type Empresa = typeof EMPRESA_DEFAULT;

export const DESCRIPCION_ACTIVIDADES_REPARTIDOR = "Recolección, transporte y entrega de paquetería y mercancía (incluyendo productos electrónicos) generada a través de las plataformas de venta y del sitio Packatelas.com.mx, dentro de las rutas y zonas de reparto que le sean asignadas en la Ciudad de México y el Estado de México; uso de la aplicación de ruteo y control de entregas de “EL PATRÓN” en cada recolección y entrega, siguiendo en su totalidad los pasos ahí establecidos; cobro de pagos contra entrega (COD) cuando así se le asigne, con la entrega diaria del efectivo cobrado y su corte de caja correspondiente; cuidado, uso adecuado y resguardo de la motocicleta, equipo de cómputo/telefonía móvil y demás herramientas de trabajo asignadas; y cumplimiento de los indicadores de desempeño (KPIs) aplicables al puesto. El detalle completo de estas actividades y responsabilidades se desarrolla en el Anexo “A” de este contrato, mismo que “EL TRABAJADOR” firma de conformidad.";
