// Capturas del manual. Los ids salen de la base local de datos ficticios (variable IDS en JSON).
const I = JSON.parse(process.env.IDS || "{}");
const path = require("path");
const PHOTO = path.join(__dirname, "paquete.jpg");
const menu = async (p) => { await p.locator('header button').first().click(); };
const stop = async (p) => { await p.getByText("Ana Torres").first().click(); await p.waitForTimeout(400); };
const deliver = async (p) => {
  await stop(p);
  const [fc] = await Promise.all([p.waitForEvent("filechooser"), p.getByRole("button", { name: "Entregado", exact: true }).click()]);
  await fc.setFiles(PHOTO);
  await p.getByAltText("Foto de evidencia").waitFor();
  await p.getByAltText("Foto de evidencia").scrollIntoViewIfNeeded();
  await p.mouse.wheel(0, 250);
};
/** Lector tipo PDA: escribe el código y Enter (en la captura no hay cámara). */
const pda = (...codes) => async (p) => {
  await p.getByRole("button", { name: "PDA / lector" }).first().click();
  const inp = p.locator('input:visible').first();
  for (const c of codes) { await inp.fill(c); await inp.press("Enter"); await p.waitForTimeout(1500); }
};
module.exports = [
  [null, "t-acceso", "/acceso", "phone"],
  ["cliente", "t-inicio", "/cliente", "phone"],
  ["cliente", "t-menu", "/cliente", "phone", menu],
  ["cliente", "t-envio", `/cliente/envio/${I.pk1}`, "phone"],
  ["cliente", "t-nuevo", "/cliente/nuevo", "phone"],
  ["cliente", "t-carga", "/cliente/carga", "phone"],
  ["cliente", "t-recolecciones", "/cliente/recolecciones", "phone"],
  ["cliente", "t-devoluciones", "/cliente/devoluciones", "phone"],
  ["cliente", "t-cuenta", "/cliente/cuenta", "phone"],
  ["cliente", "t-facturas", "/cliente/facturas", "phone"],
  ["cliente", "t-ml", "/cliente/mercadolibre", "phone"],
  ["cliente", "t-negocio", "/cliente/negocio", "phone"],
  ["cliente", "t-avisos", "/cliente/avisos", "phone"],
  ["cliente", "t-soporte", "/cliente/soporte", "phone"],
  ["cliente", "t-tienda", "/cliente/tienda", "phone"],
  [null, "r-acceso", "/acceso/empleado", "phone"],
  ["repartidor", "r-ruta", "/repartidor", "phone"],
  ["repartidor", "r-parada", "/repartidor", "phone", stop],
  ["repartidor", "r-foto", "/repartidor", "phone", deliver],
  ["repartidor", "r-escanear", "/repartidor/escanear", "phone", pda("PK-000006")],
  ["repartidor", "r-recolecciones", "/repartidor/recolecciones", "phone"],
  ["repartidor", "r-moto", "/repartidor/moto", "phone"],
  ["repartidor", "r-tarea", `/repartidor/tareas/${I.task}`, "phone"],
  ["repartidor", "r-perfil", "/repartidor/perfil", "phone"],
  ["repartidor", "r-asistencia", "/repartidor/asistencia", "phone"],
  ["admin", "a-resumen", "/admin", "desk"],
  ["admin", "a-escanear", "/admin/escanear", "desk", pda("PK-000009", "PK-000010")],
  ["admin", "a-despacho", "/admin/despacho", "desk"],
  ["admin", "a-pedidos", "/admin/pedidos", "desk"],
  ["admin", "a-pedido", `/admin/pedidos/${I.pk6}`, "desk"],
  ["admin", "a-recolecciones", "/admin/recolecciones", "desk"],
  ["admin", "a-inventario", "/admin/inventario", "desk"],
  ["admin", "a-devoluciones", "/admin/devoluciones", "desk", pda("PK-000008")],
  ["admin", "a-dv-nueva", `/admin/devoluciones/nueva?cliente=${I.cli}`, "desk"],
  ["admin", "a-repartidores", "/admin/repartidores", "desk"],
  ["admin", "a-tareas", "/admin/tareas", "desk"],
  ["admin", "a-clientes", "/admin/clientes", "desk"],
  ["admin", "a-cliente", `/admin/clientes/${I.cli}`, "desk"],
  ["admin", "a-cobros", "/admin/cobros", "desk"],
  ["admin", "a-soporte", "/admin/soporte", "desk"],
  ["admin", "a-personal", "/admin/personal", "desk"],
  ["admin", "a-checador", "/admin/checador", "desk"],
  ["admin", "a-nomina", "/admin/nomina", "desk"],
  ["admin", "a-flotilla", "/admin/flotilla", "desk"],
  ["admin", "a-avisos", "/admin/avisos", "desk"],
  ["admin", "a-usuarios", "/admin/usuarios", "desk"],
  ["admin", "a-informes", "/admin/informes", "desk"],
];
