"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { tourSeen } from "@/app/cliente/tour-actions";

type Slide = { icon: string; title: string; where?: string; steps: string[]; link?: { href: string; label: string } };

// Escrito para que cualquiera lo siga: qué es, dónde está (en el menú) y qué hacer, en pasos cortos.
const SLIDES: Slide[] = [
  {
    icon: "👋",
    title: "Bienvenido a tu portal Packatelas",
    steps: [
      "Aquí ves todo lo de tus envíos, en tiempo real.",
      "En el celular: toca el menú ☰ (arriba a la izquierda). Abajo tienes atajos a Mis envíos, Recolecciones y Estado de cuenta.",
      "En la computadora: el menú está a la izquierda.",
      "En 8 pasos te mostramos dónde está cada cosa.",
    ],
  },
  {
    icon: "🔗",
    title: "1. Conecta tu Mercado Libre",
    where: "Menú → Conectar Mercado Libre",
    steps: [
      "Toca «Conectar» y entra con tu usuario de Mercado Libre.",
      "Acepta el permiso. Listo: se hace una sola vez por cuenta.",
      "¿Por qué? Así, al recibir tu paquete vemos la dirección del comprador y lo entregamos sin retrasos.",
    ],
    link: { href: "/cliente/mercadolibre", label: "Conectar ahora" },
  },
  {
    icon: "🏠",
    title: "2. Tus direcciones y accesos",
    where: "Menú → Direcciones y accesos",
    steps: [
      "Direcciones: agrega cada bodega o tienda donde pasamos por tus paquetes.",
      "Accesos: crea un usuario para cada persona de tu equipo (ventas, bodega), con su propia contraseña.",
    ],
    link: { href: "/cliente/negocio", label: "Ir a direcciones y accesos" },
  },
  {
    icon: "🛵",
    title: "3. Solicita tu recolección",
    where: "Menú → Recolecciones",
    steps: [
      "Elige la dirección, la fecha y cuántos paquetes tienes. Toca «Solicitar».",
      "Te llega el folio por WhatsApp. Cuando el repartidor va en camino, recibes un enlace para verlo en el mapa con su nombre, foto y teléfono.",
      "Importante: recolectamos de lunes a sábado. Lo que pidas después de las 12:00 pm se agenda para el siguiente día hábil.",
    ],
    link: { href: "/cliente/recolecciones", label: "Ir a Recolecciones" },
  },
  {
    icon: "📦",
    title: "4. Tus envíos y sus evidencias",
    where: "Menú → Mis envíos",
    steps: [
      "Ves cada paquete: recibido, en camino, entregado o no entregado.",
      "Toca un envío para ver la foto de entrega, quién lo recibió y la hora.",
      "Puedes buscar por número de envío o destinatario y descargar tu reporte.",
    ],
    link: { href: "/cliente", label: "Ver mis envíos" },
  },
  {
    icon: "💰",
    title: "5. Tu saldo y cómo pagar",
    where: "Menú → Estado de cuenta y pagos",
    steps: [
      "Arriba ves tu saldo: en rojo lo que debes, en verde tu saldo a favor.",
      "Pago por transferencia: usa la CLABE que aparece ahí y escribe tu referencia en el concepto. Se aplica sola.",
      "Pago con tarjeta: en la misma página, en «Pagar con tarjeta».",
      "Abajo ves todos tus movimientos: cargos por envío y pagos.",
    ],
    link: { href: "/cliente/cuenta", label: "Ver mi saldo" },
  },
  {
    icon: "🧾",
    title: "6. Facturas y datos fiscales",
    where: "Menú → Facturas y datos fiscales",
    steps: [
      "Primero captura tus datos fiscales (cópialos de tu Constancia de Situación Fiscal). Solo una vez.",
      "Tus facturas aparecen ahí mismo para descargar en PDF y XML.",
    ],
    link: { href: "/cliente/facturas", label: "Ir a Facturas" },
  },
  {
    icon: "🔔",
    title: "7. Avisos en tu celular",
    where: "Menú → Mis avisos",
    steps: [
      "Toca «Activar» cuando el portal te pida permiso para notificaciones.",
      "Te avisamos al momento cuando entregamos, si algo no se pudo entregar, tus recolecciones y tus pagos.",
      "En «Mis avisos» eliges cuáles quieres recibir.",
    ],
    link: { href: "/cliente/avisos", label: "Elegir mis avisos" },
  },
  {
    icon: "✅",
    title: "¡Listo!",
    steps: [
      "Empieza por conectar tu Mercado Libre: es lo más importante.",
      "Puedes volver a ver esta guía cuando quieras en «Ver guía del portal», en Mis envíos.",
      "¿Dudas? Escríbenos por WhatsApp al +52 56 1123 2342.",
    ],
    link: { href: "/cliente/mercadolibre", label: "Conectar mi Mercado Libre" },
  },
];

/** Guía del portal: se abre sola en el primer acceso y se puede volver a ver. */
export function ClientTour({ open: initial }: { open: boolean }) {
  const [open, setOpen] = useState(initial);
  const [i, setI] = useState(0);
  const [, start] = useTransition();
  const close = () => {
    setOpen(false);
    start(() => void tourSeen());
  };
  if (!open) {
    return (
      <button type="button" onClick={() => { setI(0); setOpen(true); }} className="text-sm font-medium text-brand hover:underline">
        📖 Ver guía del portal
      </button>
    );
  }
  const s = SLIDES[i];
  const last = i === SLIDES.length - 1;
  return (
    <div role="dialog" aria-modal="true" aria-label="Guía del portal" className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-3 text-left sm:items-center">
      <div className="max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between">
          <span className="text-4xl" aria-hidden>{s.icon}</span>
          <button type="button" onClick={close} className="text-sm text-slate-500 hover:text-slate-800">Cerrar</button>
        </div>
        <h2 className="mt-3 text-lg font-bold">{s.title}</h2>
        {s.where && (
          <p className="mt-2 inline-block rounded-lg bg-brand/10 px-2.5 py-1 text-sm font-semibold text-brand">📍 {s.where}</p>
        )}
        <ol className="mt-3 space-y-2 text-sm leading-relaxed text-slate-700">
          {s.steps.map((t, k) => (
            <li key={k} className="flex gap-2">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] font-bold text-slate-600">{k + 1}</span>
              <span>{t}</span>
            </li>
          ))}
        </ol>
        {s.link && (
          <Link href={s.link.href} onClick={close} className="mt-4 inline-block text-sm font-semibold text-brand hover:underline">
            {s.link.label} →
          </Link>
        )}
        <div className="mt-6 flex items-center justify-between gap-3">
          <span className="text-xs text-slate-500">{i + 1} de {SLIDES.length}</span>
          <div className="flex gap-2">
            {i > 0 && (
              <button type="button" onClick={() => setI(i - 1)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">Atrás</button>
            )}
            <button type="button" onClick={() => (last ? close() : setI(i + 1))} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white">
              {last ? "Empezar" : "Siguiente"}
            </button>
          </div>
        </div>
        <div className="mt-3 h-1 overflow-hidden rounded-full bg-slate-100">
          <div className="h-full bg-brand transition-all" style={{ width: `${((i + 1) / SLIDES.length) * 100}%` }} />
        </div>
      </div>
    </div>
  );
}
