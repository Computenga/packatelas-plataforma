// Datos de desarrollo: un usuario por rol y un cliente de ejemplo.
// NO usar en producción (contraseñas conocidas).
import "dotenv/config";
import { prisma } from "./index.ts";
import { hashPassword } from "./password.ts";

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("El seed es solo para desarrollo");

  const client = await prisma.client.upsert({
    where: { publicId: "cmx00001" },
    update: {},
    create: {
      publicId: "cmx00001",
      name: "Cliente Demo",
      paymentReference: "PKT00001",
      tariffAmount: 85,
      branches: {
        create: { name: "Matriz", address: "Juan Lucas de Lassaga 54, Obrera, CDMX", lat: 19.4142, lng: -99.1405 },
      },
    },
  });

  const pw = await hashPassword("packatelas");
  const users = [
    { username: "admin", name: "Administrador", role: "ADMIN" as const },
    { username: "operador", name: "Operador Demo", role: "OPERADOR" as const },
    { username: "despacho", name: "Despachador Demo", role: "DESPACHADOR" as const },
    { username: "repartidor", name: "Repartidor Demo", role: "REPARTIDOR" as const },
    { username: "cliente", name: "Cliente Demo", role: "CLIENTE" as const, clientId: client.id },
  ];
  for (const u of users) {
    const user = await prisma.user.upsert({
      where: { username: u.username },
      update: {},
      create: { ...u, passwordHash: pw },
    });
    if (u.role === "REPARTIDOR") {
      await prisma.driver.upsert({
        where: { userId: user.id },
        update: {},
        create: { userId: user.id, vehicleType: "moto" },
      });
    }
  }
  console.log(`Seed listo: ${users.length} usuarios (contraseña: packatelas), cliente ${client.publicId}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
