import type { Metadata } from "next";
import { prisma } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import { Card, PageHeader } from "@/components/ui";
import { clientUsersAction, migrateFlexAction, migratePaymentsAction, migrateUsersAction } from "./actions";
import { MigForm } from "./forms";

export const metadata: Metadata = { title: "Migración" };

const area = "w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs";
const input = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm";

export default async function MigracionPage() {
  await requireUser(["ADMIN"]);
  const [users, drivers, flex, clientUsers, clientsWithout, pending, histPays] = await Promise.all([
    prisma.user.count({ where: { role: { not: "CLIENTE" } } }),
    prisma.driver.count(),
    prisma.flexIdentity.count(),
    prisma.user.count({ where: { role: "CLIENTE" } }),
    prisma.client.count({ where: { active: true, users: { none: {} } } }),
    prisma.user.count({ where: { mustChangePassword: true } }),
    prisma.payment.count({ where: { source: "IMPORT" } }),
  ]);
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader eyebrow="Importar y exportar" title="Migración del sistema anterior">
        Usuarios, repartidores, drivers Flex y accesos de clientes (sin saldos). Lo que ya existe no se toca.
      </PageHeader>
      <p className="text-sm text-slate-600">
        Hoy: {users} usuarios del equipo · {drivers} repartidores · {flex} drivers Flex vinculados · {clientUsers} usuarios de clientes ({clientsWithout} clientes sin usuario) · {pending} con contraseña temporal pendiente de cambiar · {histPays} pagos históricos.
      </p>

      <Card title="1. Usuarios del equipo y repartidores">
        <MigForm action={migrateUsersAction} label="Crear usuarios">
          <p className="text-xs text-slate-500">Formato por renglón (o separados por «;»): usuario|rol|nombre|carrier Shipday|activo. Rol: A admin, O operador, D despachador, R repartidor.</p>
          <textarea name="users" rows={4} className={area} />
          <input name="usersFile" type="file" accept=".txt,.csv" className="text-sm" />
          <input name="tempPassword" type="text" autoComplete="off" placeholder="Contraseña temporal para todos" className={input} required />
        </MigForm>
      </Card>

      <Card title="2. Drivers Flex">
        <MigForm action={migrateFlexAction} label="Vincular">
          <p className="text-xs text-slate-500">Formato: driver Flex,usuario,envío. Si el driver ya está vinculado en esta plataforma, se queda como está.</p>
          <textarea name="flex" rows={4} className={area} />
          <input name="flexFile" type="file" accept=".txt,.csv" className="text-sm" />
        </MigForm>
      </Card>

      <Card title="3. Usuarios del portal de clientes">
        <MigForm action={clientUsersAction} label="Crear usuarios de clientes">
          <p className="text-xs text-slate-500">Crea un usuario por cliente activo que no tenga: el usuario es su ID (p. ej. cmx00114).</p>
          <input name="tempPassword" type="text" autoComplete="off" placeholder="Contraseña temporal para todos" className={input} required />
        </MigForm>
      </Card>

      <Card title="4. Historial de pagos">
        <MigForm action={migratePaymentsAction} label="Importar pagos">
          <p className="text-xs text-slate-500">Archivo preparado (TSV): fecha, cliente_id, monto, referencia, método, nota, llave. Solo historial: no mueve saldos ni se factura; no se duplica.</p>
          <input name="paymentsFile" type="file" accept=".txt,.tsv" className="text-sm" />
        </MigForm>
      </Card>
    </div>
  );
}
