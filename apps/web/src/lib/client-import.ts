// Migración de clientes del sistema actual [A21]: lectura y validación del archivo.
import type { ClientImportRow } from "@packatelas/db";
import { norm } from "./bulk-import";

type Field = keyof ClientImportRow;

const ALIASES: Record<Field, string[]> = {
  publicId: ["id", "id cliente", "id publico", "cliente id", "clave", "codigo", "cmx", "numero de cliente"],
  name: ["nombre", "cliente", "nombre cliente", "tienda", "negocio", "nombre comercial", "razon comercial"],
  contactName: ["contacto", "nombre contacto", "responsable"],
  phone: ["telefono", "tel", "celular", "whatsapp"],
  email: ["correo", "email", "e-mail", "correo electronico"],
  rfc: ["rfc"],
  legalName: ["razon social", "nombre fiscal"],
  taxRegime: ["regimen", "regimen fiscal"],
  taxZip: ["cp fiscal", "codigo postal fiscal", "domicilio fiscal cp"],
  cfdiUse: ["uso cfdi", "uso de cfdi"],
  tariffAmount: ["tarifa", "precio", "costo por envio", "tarifa por envio"],
  pickupAddress: ["direccion", "direccion recoleccion", "direccion de recoleccion", "domicilio", "recoleccion"],
  active: ["activo", "estatus", "estado"],
  openingBalance: ["saldo", "saldo actual", "adeudo", "saldo inicial", "balance", "saldo neto"],
  flexDynamic: ["flex dinamica", "tarifa flex dinamica", "modo tarifa", "modo de tarifa", "tipo de tarifa"],
  chargingEnabled: ["cobro activo", "cobro", "cobro habilitado", "facturar"],
  pickupExemptUntil: ["exento hasta", "exencion hasta", "exenta hasta"],
  pickupExemptNote: ["motivo exencion", "motivo de exencion", "motivo"],
};

export const CLIENT_FIELD_LABEL: Record<Field, string> = {
  publicId: "ID (cmx…)", name: "Nombre", contactName: "Contacto", phone: "Teléfono", email: "Correo", rfc: "RFC",
  legalName: "Razón social", taxRegime: "Régimen", taxZip: "CP fiscal", cfdiUse: "Uso CFDI", tariffAmount: "Tarifa",
  pickupAddress: "Dirección de recolección", active: "Activo", openingBalance: "Saldo",
  flexDynamic: "Flex dinámica", chargingEnabled: "Cobro activo", pickupExemptUntil: "Exento hasta", pickupExemptNote: "Motivo exención",
};

/** "$1,234.50", "-1,234.50", "(1,234.50)" → número; null si no es monto. */
export function parseMoney(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  const neg = /^\(.*\)$/.test(s) || /^-/.test(s.replace(/[$\s]/g, ""));
  const digits = s.replace(/[()$\s,-]/g, "").replace(/mxn/i, "");
  if (!/^\d+(\.\d{1,2})?$/.test(digits)) return null;
  return (neg ? -1 : 1) * Number(digits);
}

function parseActive(raw: string): boolean | undefined {
  const n = norm(raw);
  if (!n) return undefined;
  if (["si", "sí", "activo", "activa", "1", "true", "x"].includes(n)) return true;
  if (["no", "inactivo", "inactiva", "baja", "0", "false", "suspendido"].includes(n)) return false;
  return undefined;
}

export type ClientRow = { line: number; data: Partial<ClientImportRow>; errors: string[] };

/**
 * @param negativeIsDebt si el sistema anterior muestra el adeudo como negativo, se invierte el signo
 *   (aquí positivo = el cliente debe).
 */
export function readClientRows(
  table: string[][],
  normalizeId: (raw: string) => string | null,
  { negativeIsDebt = false } = {},
): { rows: ClientRow[]; error?: string; unknown: string[]; fields: Field[] } {
  if (table.length < 2) return { rows: [], unknown: [], fields: [], error: "Pega los encabezados y al menos un cliente" };
  const map: Partial<Record<Field, number>> = {};
  const unknown: string[] = [];
  table[0].forEach((h, i) => {
    const n = norm(h);
    const f = (Object.keys(ALIASES) as Field[]).find((k) => ALIASES[k].includes(n));
    if (f && map[f] === undefined) map[f] = i;
    else if (n) unknown.push(h);
  });
  if (map.publicId === undefined) return { rows: [], unknown, fields: [], error: 'Falta la columna "ID" (cmx… o emx…)' };
  if (map.name === undefined) return { rows: [], unknown, fields: [], error: 'Falta la columna "Nombre"' };

  const seen = new Map<string, number>();
  const rows = table.slice(1).map((cells, idx): ClientRow => {
    const get = (f: Field) => (map[f] === undefined ? "" : (cells[map[f]!] ?? "").trim());
    const errors: string[] = [];
    const data: Partial<ClientImportRow> = {};
    const pid = normalizeId(get("publicId"));
    if (!pid) errors.push(`ID inválido "${get("publicId")}"`);
    else {
      data.publicId = pid;
      if (seen.has(pid)) errors.push(`ID repetido (renglón ${seen.get(pid)})`);
      else seen.set(pid, idx + 2);
    }
    data.name = get("name").slice(0, 200);
    if (data.name.length < 2) errors.push("Falta nombre");
    for (const f of ["contactName", "phone", "email", "rfc", "legalName", "taxRegime", "taxZip", "cfdiUse", "pickupAddress", "pickupExemptNote"] as const) {
      const v = get(f);
      if (v) data[f] = v.slice(0, 300);
    }
    if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) errors.push("Correo inválido");
    if (data.rfc && !/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/i.test(data.rfc)) errors.push("RFC inválido");
    if (get("tariffAmount")) {
      const t = parseMoney(get("tariffAmount"));
      if (t == null || t < 0 || t > 100000) errors.push("Tarifa inválida");
      else data.tariffAmount = t;
    }
    if (get("openingBalance")) {
      const b = parseMoney(get("openingBalance"));
      if (b == null || Math.abs(b) > 10_000_000) errors.push("Saldo inválido");
      else data.openingBalance = negativeIsDebt ? -b : b;
    }
    const act = parseActive(get("active"));
    if (act !== undefined) data.active = act;
    const charging = parseActive(get("chargingEnabled"));
    if (charging !== undefined) data.chargingEnabled = charging;
    const mode = norm(get("flexDynamic"));
    if (mode) data.flexDynamic = /flex|dinamic|ml_flex/.test(mode) || parseActive(mode) === true;
    const ex = get("pickupExemptUntil");
    if (ex) {
      const m = ex.match(/^(\d{4})-(\d{2})-(\d{2})$/) ?? ex.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (!m) errors.push("Fecha de exención inválida (AAAA-MM-DD o DD/MM/AAAA)");
      else data.pickupExemptUntil = m[1].length === 4 ? `${m[1]}-${m[2]}-${m[3]}` : `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    }
    return { line: idx + 2, data, errors };
  });
  return { rows, unknown, fields: (Object.keys(map) as Field[]) };
}
