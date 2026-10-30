import "server-only";
import { redirect } from "next/navigation";
import type { Role } from "@packatelas/db";
import { getSessionUser } from "./session";
import { homeFor } from "./roles";

export type CurrentUser = NonNullable<Awaited<ReturnType<typeof getSessionUser>>>;

/**
 * Exige sesión y, si se indican, uno de los roles permitidos.
 * Sin sesión → /login. Con un rol no permitido → la página de inicio de su propio rol.
 * Usar en cada layout, página y Server Action protegidos (nunca confiar solo en el proxy).
 */
export async function requireUser(roles?: Role[]): Promise<CurrentUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  // Contraseña temporal (migración o alta): primero la cambia.
  if (user.mustChangePassword) redirect("/cambiar-contrasena");
  if (roles && !roles.includes(user.role)) redirect(homeFor(user.role));
  return user;
}
