// Uso de emergencia (único admin sin acceso a su app autenticadora):
//   docker compose exec migrate npx tsx src/reset-2fa.ts <usuario>
import "dotenv/config";
import { prisma } from "./index.ts";

const username = process.argv[2]?.toLowerCase();
if (!username) {
  console.error("Uso: npx tsx src/reset-2fa.ts <usuario>");
  process.exit(1);
}
const r = await prisma.user.updateMany({ where: { username }, data: { totpSecret: null, totpLastStep: null } });
console.log(r.count ? `Verificación en dos pasos quitada a ${username}` : `No existe el usuario ${username}`);
await prisma.$disconnect();
