import { NextResponse, type NextRequest } from "next/server";

// Revisión optimista: sin cookie de sesión no tiene caso renderizar páginas protegidas.
// La validación real (sesión vigente y rol) ocurre en el servidor con requireUser().
export function proxy(request: NextRequest) {
  if (!request.cookies.has("pk_session")) {
    const url = new URL("/login", request.url);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/cliente/:path*", "/repartidor/:path*", "/empleado/:path*"],
};
