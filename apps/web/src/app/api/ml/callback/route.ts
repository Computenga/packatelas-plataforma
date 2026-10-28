import { connectCourier, connectMlAccount, COURIER_STATE_PREFIX, prisma, readMlState } from "@packatelas/db";

/** Regreso del OAuth de MercadoLibre: liga la cuenta del vendedor a su cliente [I02]. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const base = process.env.PUBLIC_URL?.replace(/\/$/, "") || url.origin;
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const back = (q: Record<string, string>) => Response.redirect(`${base}/ml/conectado?${new URLSearchParams(q)}`, 303);
  if (!code || !state) return back({ error: url.searchParams.get("error_description") ?? "MercadoLibre no envió la autorización" });
  // Autorización de la cuenta de la mensajería (Packatelas ante ML), no de un vendedor.
  const who = readMlState(state);
  if (who?.startsWith(COURIER_STATE_PREFIX)) {
    const page = (q: Record<string, string>) => Response.redirect(`${base}/admin/mercadolibre/mensajeria?${new URLSearchParams(q)}`, 303);
    try {
      const r = await connectCourier(prisma, code, who.slice(COURIER_STATE_PREFIX.length) || null);
      return r.ok ? page({ ok: `${r.nickname} (${r.userId})` }) : page({ error: r.error });
    } catch (e) {
      console.error("[ml] callback mensajería", e);
      return page({ error: "No se pudo completar la autorización. Intenta de nuevo." });
    }
  }
  try {
    const r = await connectMlAccount(prisma, { code, state });
    if (!r.ok) return back({ error: r.error });
    return back({ cuenta: r.nickname, cliente: r.clientName, ...(r.elsewhere ? { registrada: r.elsewhere.publicId } : {}) });
  } catch (e) {
    console.error("[ml] callback", e);
    return back({ error: "No se pudo completar la conexión con MercadoLibre. Intenta de nuevo." });
  }
}
