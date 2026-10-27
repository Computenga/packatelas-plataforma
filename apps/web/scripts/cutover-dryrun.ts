// Simulacro del arranque contra una COPIA de la base (nunca contra producción):
//   DATABASE_URL=postgresql://…/copia npx tsx scripts/cutover-dryrun.ts saldos.csv
// 1) Limpia los datos de prueba, 2) carga los saldos del sistema anterior con el mismo
// importador que usa el admin, 3) verifica que todo cuadre.
import { readFileSync } from "node:fs";
import { cutoverPreview, getClientBalance, importClients, normalizePublicId, prisma, resetForCutover, CUTOVER_CONFIRM } from "@packatelas/db";
import { parseTable } from "../src/lib/bulk-import";
import { readClientRows } from "../src/lib/client-import";

const file = process.argv[2];
if (!file) throw new Error("Uso: cutover-dryrun.ts <saldos.csv>");
if (/nuevo\.packatelas|admin\.packatelas|@db:5432/.test(process.env.DATABASE_URL ?? "")) throw new Error("Esto es solo para una copia de la base");

const ok = (c: boolean, m: string) => console.log(`${c ? "ok  " : "FALLA"} ${m}`);

async function main() {
  const admin = await prisma.user.findFirstOrThrow({ where: { role: "ADMIN" } });
  console.log("Antes:", JSON.stringify(await cutoverPreview(prisma)));
  const mlBefore = await prisma.mlAccount.count();
  const clientsBefore = await prisma.client.count();

  const t0 = Date.now();
  const { evidenceKeys } = await resetForCutover(prisma, admin.id, CUTOVER_CONFIRM);
  console.log(`Limpieza en ${Date.now() - t0} ms; ${evidenceKeys.length} fotos por borrar del disco`);
  const after = await cutoverPreview(prisma);
  ok(after.borrar.envios === 0 && after.borrar.movimientos === 0 && after.borrar.recolecciones === 0, "sin envíos, movimientos ni recolecciones de prueba");
  ok(after.archivar.pagos === 0, "depósitos previos archivados");
  ok((await prisma.mlAccount.count()) === mlBefore && (await prisma.client.count()) === clientsBefore, "clientes y cuentas ML intactos");
  let threw = false;
  try { await resetForCutover(prisma, admin.id, CUTOVER_CONFIRM); } catch { threw = true; }
  ok(threw, "la limpieza no se puede repetir");

  const parsed = readClientRows(parseTable(readFileSync(file, "utf8")), normalizePublicId);
  if (parsed.error) throw new Error(parsed.error);
  const rows = parsed.rows.filter((r) => r.errors.length === 0).map((r) => r.data);
  console.log(`Archivo: ${rows.length} clientes válidos, ${parsed.rows.length - rows.length} con errores`);
  const expected = rows.reduce((s, r) => s + (r.openingBalance ?? 0), 0);
  const res = await importClients(prisma, { batchId: `dryrun-${Date.now()}`, rows: rows as never }, admin.id);
  console.log(`Importados: ${res.created.length} nuevos, ${res.updated.length} actualizados, ${res.balances} saldos`);
  let total = 0;
  for (const r of rows) {
    const c = await prisma.client.findUnique({ where: { publicId: r.publicId! } });
    if (c) total += Number(await getClientBalance(prisma, c.id));
  }
  ok(Math.abs(total - expected) < 0.01, `saldo total ${total.toFixed(2)} = archivo ${expected.toFixed(2)}`);
  const again = await importClients(prisma, { batchId: `dryrun2-${Date.now()}`, rows: rows as never }, admin.id);
  ok(again.balances === 0, "reimportar no duplica saldos");
  console.log("Después:", JSON.stringify(await cutoverPreview(prisma)));
  await prisma.$disconnect();
}
void main();
