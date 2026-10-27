import Image from "next/image";

/** Isotipo (la caja) de Packatelas. */
export function Isotipo({ className = "h-8 w-auto" }: { className?: string }) {
  return <Image src="/brand/isotipo.png" alt="Packatelas" width={928} height={606} className={className} priority />;
}

/** Logo horizontal (caja + PACKATELAS). */
export function Logo({ className = "h-8 w-auto", light = false }: { className?: string; light?: boolean }) {
  return <Image src={light ? "/brand/logo-horizontal-blanco.png" : "/brand/logo-horizontal.png"} alt="Packatelas" width={1724} height={276} className={className} priority />;
}
