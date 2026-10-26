import { getSessionUser } from "@/lib/session";
import { placeDetails } from "@/lib/geocode-providers";

/** Detalle (coordenadas y componentes) de una sugerencia de Google; cierra la sesión de cobro. */
export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "No autorizado" }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const id = params.get("id") ?? "";
  const session = (params.get("session") ?? "").slice(0, 64);
  try {
    const result = await placeDetails(id, session);
    if (!result) return Response.json({ error: "No se encontró la ubicación" }, { status: 404 });
    return Response.json({ result });
  } catch {
    return Response.json({ error: "No se pudo obtener la ubicación; colócala en el mapa." }, { status: 502 });
  }
}
