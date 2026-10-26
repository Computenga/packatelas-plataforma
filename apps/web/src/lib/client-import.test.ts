import { describe, expect, it } from "vitest";
import { parseTable } from "./bulk-import";
import { parseMoney, readClientRows } from "./client-import";
import { normalizePublicId } from "@packatelas/db/public-id";

const nid = normalizePublicId;

describe("parseMoney", () => {
  it("lee formatos contables", () => {
    expect(parseMoney("$1,234.50")).toBe(1234.5);
    expect(parseMoney("-$80")).toBe(-80);
    expect(parseMoney("(1,000.00)")).toBe(-1000);
    expect(parseMoney("abc")).toBeNull();
  });
});

describe("readClientRows", () => {
  const t = parseTable(
    "ID Cliente\tNombre\tTeléfono\tCorreo\tTarifa\tSaldo\tEstatus\tOtra\n" +
    "CMX114\tTienda Uno\t5511112222\tUNO@MAIL.COM\t$75.00\t$1,500.00\tActivo\tz\n" +
    "cmx00127-Granjas\tTienda Dos\t\tmal-correo\t70\t-200\tBaja\t\n" +
    "xmx141\tX\t\t\tgratis\t\t\t\n" +
    "cmx114\tDuplicado\t\t\t\t\t\t\n",
  );
  it("mapea encabezados, valida y marca duplicados", () => {
    const r = readClientRows(t, nid);
    expect(r.error).toBeUndefined();
    expect(r.unknown).toEqual(["Otra"]);
    expect(r.rows[0]).toMatchObject({ errors: [], data: { publicId: "cmx00114", tariffAmount: 75, openingBalance: 1500, active: true } });
    expect(r.rows[1].data).toMatchObject({ publicId: "cmx00127-granjas", openingBalance: -200, active: false });
    expect(r.rows[1].errors).toEqual(["Correo inválido"]);
    expect(r.rows[2].errors).toEqual(['ID inválido "xmx141"', "Falta nombre", "Tarifa inválida"]);
    expect(r.rows[3].errors).toEqual(["ID repetido (renglón 2)"]);
  });
  it("invierte el signo si el sistema anterior muestra el adeudo negativo", () => {
    expect(readClientRows(t, nid, { negativeIsDebt: true }).rows[0].data.openingBalance).toBe(-1500);
  });
});

describe("ida y vuelta con la exportación de clientes", () => {
  it("todos los encabezados exportados se reconocen al volver a importar", async () => {
    const { readClientRows } = await import("./client-import");
    const head = ["ID", "Nombre", "Contacto", "Teléfono", "Correo", "RFC", "Razón social", "Régimen", "CP fiscal", "Uso CFDI", "Tarifa", "Flex dinámica", "Cobro activo", "Activo", "Exento hasta", "Motivo exención", "Dirección de recolección", "Referencia de pago", "Saldo"];
    const r = readClientRows([head, ["cmx00001", "Tienda", "", "", "", "", "", "", "", "", "85.00", "No", "Sí", "Sí", "", "", "Calle 1", "CMX00001", "0.00"]], (s) => s);
    expect(r.unknown).toEqual(["Referencia de pago"]);
    expect(r.fields).toHaveLength(head.length - 1);
  });
});
