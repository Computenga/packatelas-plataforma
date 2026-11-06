"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Recarga la bandeja cada 15 s mientras está abierta (y al volver a la pestaña). */
export function LiveRefresh() {
  const router = useRouter();
  useEffect(() => {
    const tick = () => { if (document.visibilityState === "visible") router.refresh(); };
    const t = setInterval(tick, 15_000);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", tick); };
  }, [router]);
  return null;
}
