"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { logout } from "@/app/login/actions";
import { FlexLink } from "./perfil/flex-link";

/**
 * Paso obligatorio: sin su ID de driver Flex vinculado, los paquetes que toma en Mercado Libre no
 * se le asignan. La app no deja seguir hasta vincularlo (oficina puede marcar a quien no usa Flex).
 */
export function FlexGate() {
  const router = useRouter();
  return (
    <div className="fixed inset-0 z-[60] overflow-y-auto bg-floor p-4" role="dialog" aria-modal="true" aria-labelledby="flex-gate-title">
      <div className="mx-auto max-w-md space-y-4 rounded-2xl bg-white p-5 shadow-lg">
        <h1 id="flex-gate-title" className="text-xl font-bold">Vincula tu Mercado Libre Flex</h1>
        <p className="text-sm text-slate-700">
          Es obligatorio y se hace <strong>una sola vez</strong>. Sin este paso los pedidos que tomas en la app Flex <strong>no se te asignan</strong> aquí y no podrás trabajar en la app.
        </p>
        <FlexLink onLinked={() => router.refresh()} />
        <p className="text-xs text-slate-500">
          ¿Aún no tienes ningún paquete en Flex? Toma uno en tu app de Mercado Libre al cargar y vuelve aquí. Si no usas Flex, avísale a oficina para que te quite este paso.
        </p>
        <div className="flex justify-between text-sm">
          <Link href="/ayuda/repartidor" className="text-brand">📖 Manual</Link>
          <form action={logout}><button className="text-slate-500 underline">Cerrar sesión</button></form>
        </div>
      </div>
    </div>
  );
}
