import { text } from "@/lib/iclock";

/** Resultado de comandos: como no enviamos comandos, solo se confirma. */
export async function POST() {
  return text("OK");
}
