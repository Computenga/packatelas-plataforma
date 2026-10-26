// Se ejecuta en cada despliegue después de las migraciones.
// Si aún no existe ningún administrador y están definidas BOOTSTRAP_ADMIN_USER y
// BOOTSTRAP_ADMIN_PASSWORD, crea el primero. Si ya hay administradores, no hace nada.
import "dotenv/config";
import { prisma } from "./index.ts";
import { hashPassword } from "./password.ts";

async function main() {
  const username = process.env.BOOTSTRAP_ADMIN_USER?.trim().toLowerCase();
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD ?? "";
  const admins = await prisma.user.count({ where: { role: "ADMIN", active: true } });
  if (admins > 0) {
    console.log("[bootstrap] Ya existe un administrador; nada que hacer.");
    return;
  }
  if (!username || password.length < 12) {
    console.log("[bootstrap] Sin administrador. Define BOOTSTRAP_ADMIN_USER y BOOTSTRAP_ADMIN_PASSWORD (12+ caracteres) y vuelve a desplegar.");
    return;
  }
  await prisma.user.create({
    data: { username, name: "Administrador", role: "ADMIN", passwordHash: await hashPassword(password) },
  });
  console.log(`[bootstrap] Administrador "${username}" creado. Quita BOOTSTRAP_ADMIN_PASSWORD de las variables.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
