import { connectMlAccount, prisma } from "@packatelas/db";

/** Regreso del OAuth de MercadoLibre: liga la cuenta del vendedor a su cliente [I02]. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const base = process.env.PUBLIC_URL?.replace(/\/$/, "") || url.origin;
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const back = (q: Record<string, string>) => Response.redirect(`${base}/ml/conectado?${new URLSearchParams(q)}`, 303);
  if (!code || !state) return back({ error: url.searchParams.get("error_description") ?? "MercadoLibre no envió la autorización" });
  try {
    const r = await connectMlAccount(prisma, { code, state });
    return r.ok ? back({ cuenta: r.nickname, cliente: r.clientName }) : back({ error: r.error });
  } catch (e) {
    console.error("[ml] callback", e);
    return back({ error: "No se pudo completar la conexión con MercadoLibre. Intenta de nuevo." });
  }
}
