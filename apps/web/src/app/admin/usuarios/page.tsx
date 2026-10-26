import type { Metadata } from "next";
import { prisma } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import { ROLE_LABEL } from "@/lib/roles";
import { fecha } from "@/lib/format";
import { ActionForm } from "@/components/action-form";
import { Badge, Button, Card, Field, PageHeader, Select, Table, Td } from "@/components/ui";
import { createUser, resetPassword, resetTwoFactor, toggleActive } from "./actions";

export const metadata: Metadata = { title: "Usuarios" };

export default async function UsuariosPage() {
  const me = await requireUser(["ADMIN"]);
  const users = await prisma.user.findMany({
    where: { role: { not: "CLIENTE" } },
    orderBy: [{ active: "desc" }, { role: "asc" }, { username: "asc" }],
  });

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader eyebrow="Gestión" title="Usuarios">
        Equipo interno y repartidores. Los accesos de clientes se crean desde la ficha de cada cliente.
      </PageHeader>

      <Card title="Nuevo usuario">
        <ActionForm action={createUser} submitLabel="Crear usuario" resetOnSuccess>
          <div className="grid gap-4 md:grid-cols-5">
            <Field label="Usuario" name="username" autoCapitalize="none" required />
            <Field label="Nombre" name="name" required />
            <Select label="Rol" name="role" defaultValue="REPARTIDOR">
              <option value="REPARTIDOR">Repartidor</option>
              <option value="OPERADOR">Operador</option>
              <option value="DESPACHADOR">Despachador</option>
              <option value="ADMIN">Administrador</option>
              <option value="EMPLEADO">Empleado</option>
              <option value="MECANICO">Mecánico</option>
            </Select>
            <Field label="Teléfono" name="phone" inputMode="tel" hint="Solo repartidores" />
            <Field label="Contraseña" name="password" type="password" minLength={8} required />
          </div>
        </ActionForm>
      </Card>

      <Table head={["Usuario", "Nombre", "Rol", "Último acceso", "Estado", "Dos pasos", "Contraseña", ""]}>
        {users.map((u) => (
          <tr key={u.id} className={u.active ? "" : "bg-slate-50 text-slate-400"}>
            <Td className="font-mono text-xs">{u.username}</Td>
            <Td>{u.name}</Td>
            <Td>{ROLE_LABEL[u.role]}</Td>
            <Td>{fecha(u.lastLoginAt)}</Td>
            <Td>{u.active ? <Badge tone="green">Activo</Badge> : <Badge>Inactivo</Badge>}</Td>
            <Td>
              {u.totpSecret ? (
                u.id !== me.id ? (
                  <form action={resetTwoFactor.bind(null, u.id)} className="flex items-center gap-2">
                    <Badge tone="green">Sí</Badge>
                    <button className="text-xs text-red-600 hover:underline">Quitar</button>
                  </form>
                ) : <Badge tone="green">Sí</Badge>
              ) : <span className="text-xs text-slate-400">No</span>}
            </Td>
            <Td>
              <details>
                <summary className="cursor-pointer text-sm text-brand">Cambiar</summary>
                <div className="mt-2 w-64">
                  <ActionForm action={resetPassword.bind(null, u.id)} submitLabel="Guardar" resetOnSuccess>
                    <Field label="Nueva contraseña" name="password" type="password" minLength={8} required />
                  </ActionForm>
                </div>
              </details>
            </Td>
            <Td>
              {u.id !== me.id && (
                <form action={toggleActive.bind(null, u.id)}>
                  <Button variant={u.active ? "ghost" : "secondary"}>{u.active ? "Desactivar" : "Activar"}</Button>
                </form>
              )}
            </Td>
          </tr>
        ))}
      </Table>
    </div>
  );
}
