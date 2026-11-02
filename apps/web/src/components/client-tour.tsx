"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { tourSeen } from "@/app/cliente/tour-actions";

const SLIDES: { icon: string; title: string; body: string; link?: { href: string; label: string } }[] = [
  {
    icon: "👋",
    title: "Bienvenido al nuevo portal de Packatelas",
    body: "Todo en un solo lugar y en tiempo real: tus envíos, recolecciones, pagos y facturas. Te mostramos lo nuevo en 1 minuto.",
  },
  {
    icon: "📦",
    title: "Mis envíos, al momento",
    body: "Ve en qué va cada paquete: recibido, en camino o entregado con foto de evidencia y nombre de quien recibió. Busca, filtra y descarga tu reporte. También puedes crear envíos externos (fuera de Mercado Libre) uno por uno o varios a la vez.",
    link: { href: "/cliente", label: "Ver mis envíos" },
  },
  {
    icon: "🔗",
    title: "Conecta tu Mercado Libre",
    body: "Es el paso más importante: con tu cuenta conectada, al escanear tu paquete vemos la dirección del comprador y lo entregamos sin retrasos. Se hace una sola vez por cuenta.",
    link: { href: "/cliente/mercadolibre", label: "Conectar ahora" },
  },
  {
    icon: "🛵",
    title: "Recolecciones con seguimiento en vivo",
    body: "Pide tu recolección y recibe su folio por WhatsApp. Cuando el repartidor va en camino te llega un enlace para verlo en el mapa, con su nombre, foto y teléfono.",
    link: { href: "/cliente/recolecciones", label: "Ver recolecciones" },
  },
  {
    icon: "💳",
    title: "Pagos y facturas",
    body: "Tu estado de cuenta se actualiza solo. Paga por transferencia con tu referencia o con tarjeta, y descarga tus facturas. Captura tus datos fiscales una vez y listo.",
    link: { href: "/cliente/cuenta", label: "Ver estado de cuenta" },
  },
  {
    icon: "🔔",
    title: "Avisos al momento",
    body: "Activa las notificaciones en tu celular o computadora: te avisamos cuando entregamos, si algo no se pudo entregar, tus recolecciones y pagos. Tú eliges cuáles en «Mis avisos».",
    link: { href: "/cliente/avisos", label: "Elegir mis avisos" },
  },
];

/** Recorrido corto del portal nuevo: se muestra en el primer acceso y se puede volver a ver. */
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
      <button type="button" onClick={() => { setI(0); setOpen(true); }} className="text-sm text-brand hover:underline">
        Ver recorrido del portal
      </button>
    );
  }
  const s = SLIDES[i];
  const last = i === SLIDES.length - 1;
  return (
    <div role="dialog" aria-modal="true" aria-label="Recorrido del portal" className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-3 sm:items-center">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between">
          <span className="text-4xl" aria-hidden>{s.icon}</span>
          <button type="button" onClick={close} className="text-sm text-slate-500 hover:text-slate-800">Saltar</button>
        </div>
        <h2 className="mt-3 text-lg font-bold">{s.title}</h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">{s.body}</p>
        {s.link && (
          <Link href={s.link.href} onClick={close} className="mt-3 inline-block text-sm font-semibold text-brand hover:underline">
            {s.link.label} →
          </Link>
        )}
        <div className="mt-6 flex items-center justify-between">
          <div className="flex gap-1.5" aria-label={`Paso ${i + 1} de ${SLIDES.length}`}>
            {SLIDES.map((_, k) => (
              <span key={k} className={`h-2 rounded-full transition-all ${k === i ? "w-5 bg-brand" : "w-2 bg-slate-200"}`} />
            ))}
          </div>
          <div className="flex gap-2">
            {i > 0 && (
              <button type="button" onClick={() => setI(i - 1)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">Atrás</button>
            )}
            <button type="button" onClick={() => (last ? close() : setI(i + 1))} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white">
              {last ? "Empezar" : "Siguiente"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
