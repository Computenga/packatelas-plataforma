import "server-only";
import { redirect } from "next/navigation";
import { requireUser } from "./auth";

/** Usuario cliente con su clientId; todas las consultas del portal se filtran por él. */
export async function requireClient() {
  const user = await requireUser(["CLIENTE"]);
  if (!user.clientId) redirect("/cliente");
  return { user, clientId: user.clientId };
}
