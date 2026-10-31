import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Logo } from "@/components/brand";

export const metadata: Metadata = { title: "Aviso de privacidad", description: "Aviso de privacidad de Packatelas (Comercializadora Computenga)" };

const UPDATED = "31 de octubre de 2026";
const CONTACT_WA = "+52 56 1123 2342";
const ADDRESS = "Juan Lucas de Lassaga 54, piso 1, Col. Obrera, Cuauhtémoc, 06800, Ciudad de México";

function Section({ id, title, children }: { id?: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-6 space-y-2">
      <h2 className="text-base font-semibold text-slate-900">{title}</h2>
      <div className="space-y-2 text-sm leading-relaxed text-slate-700">{children}</div>
    </section>
  );
}

/** Aviso de privacidad público (lo pide Meta para publicar la app de WhatsApp). */
export default function PrivacidadPage() {
  return (
    <main className="min-h-dvh bg-slate-50 px-4 py-10">
      <article className="mx-auto max-w-2xl space-y-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-10">
        <header className="space-y-3">
          <Logo className="h-9 w-auto" />
          <h1 className="text-2xl font-bold">Aviso de privacidad</h1>
          <p className="text-xs text-slate-500">Última actualización: {UPDATED}</p>
        </header>

        <Section title="Quién es responsable de tus datos">
          <p>
            <strong>Comercializadora Computenga</strong>, que opera el servicio de mensajería <strong>Packatelas</strong> (en adelante, «Packatelas»), con domicilio
            en {ADDRESS}, es responsable del tratamiento de los datos personales que se describen en este aviso, conforme a la legislación mexicana de protección
            de datos personales en posesión de particulares.
          </p>
        </Section>

        <Section title="Qué datos usamos">
          <p>Según tu relación con nosotros, tratamos:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li><strong>Si recibes un envío:</strong> nombre, teléfono, dirección de entrega, referencias, y la foto, nombre de quien recibe y ubicación del momento de la entrega.</li>
            <li><strong>Si eres cliente (tienda o vendedor):</strong> nombre o razón social, contacto, teléfono, correo, direcciones de recolección, datos fiscales para facturar, pagos y saldo, y la información de tus envíos que nos comparte Mercado Libre cuando conectas tu cuenta.</li>
            <li><strong>Si eres repartidor o colaborador:</strong> los datos de tu expediente laboral y la ubicación de tu teléfono únicamente durante tu turno.</li>
          </ul>
          <p>No solicitamos datos personales sensibles.</p>
        </Section>

        <Section title="Para qué los usamos">
          <p>Finalidades necesarias para darte el servicio:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>Recolectar, transportar y entregar paquetes, y comprobar la entrega.</li>
            <li>
              Enviarte avisos sobre tu envío o recolección por <strong>WhatsApp</strong> (por ejemplo: «va en camino», con un enlace para seguir al repartidor en
              tiempo real; «entregado»; o «no se pudo entregar»), y responder tus dudas.
            </li>
            <li>Cobrar, facturar y llevar el saldo de los clientes.</li>
            <li>Atender aclaraciones, devoluciones e incidencias, y cumplir obligaciones legales.</li>
          </ul>
          <p>No usamos tus datos para publicidad ni los vendemos.</p>
        </Section>

        <Section title="Con quién los compartimos">
          <ul className="list-disc space-y-1 pl-5">
            <li><strong>La tienda o vendedor</strong> que te envió el paquete, para informarle el estado de la entrega.</li>
            <li><strong>Mercado Libre</strong>, cuando el envío es de esa plataforma, para reportar su estado.</li>
            <li>
              Proveedores que nos ayudan a operar, solo para esa finalidad: <strong>Meta (WhatsApp Business)</strong> para los avisos, el proveedor de
              servidores donde se aloja la plataforma, servicios de mapas y rutas, el procesador de pagos con tarjeta y el proveedor de facturación electrónica.
            </li>
            <li>Autoridades, cuando una ley o una orden lo exija.</li>
          </ul>
        </Section>

        <Section title="Cuánto tiempo los guardamos">
          <p>
            Conservamos la información de cada envío el tiempo necesario para la entrega, aclaraciones y obligaciones fiscales y legales. La ubicación detallada de
            los repartidores se borra automáticamente con el tiempo.
          </p>
        </Section>

        <Section id="derechos" title="Tus derechos (ARCO) y cómo dejar de recibir avisos">
          <p>
            Puedes pedir <strong>acceder</strong> a tus datos, <strong>rectificarlos</strong>, <strong>cancelarlos</strong> u <strong>oponerte</strong> a su uso, así
            como revocar tu consentimiento. Escríbenos por WhatsApp al <strong>{CONTACT_WA}</strong> o acude a nuestro domicilio, indicando tu nombre, el número de
            envío o teléfono relacionado y lo que solicitas. Te responderemos en un máximo de 20 días hábiles.
          </p>
          <p>
            Para dejar de recibir avisos por WhatsApp, responde <strong>«BAJA»</strong> a cualquiera de nuestros mensajes o bloquea el número; esto no afecta la
            entrega de tu paquete.
          </p>
        </Section>

        <Section id="eliminacion" title="Eliminación de datos">
          <p>
            Para pedir que eliminemos tus datos, envía por WhatsApp al <strong>{CONTACT_WA}</strong> el mensaje «Eliminar mis datos» con el teléfono o número de
            envío relacionado. Los borraremos o anonimizaremos salvo lo que la ley nos obligue a conservar (por ejemplo, información fiscal), y te confirmaremos
            por el mismo medio.
          </p>
        </Section>

        <Section title="Cambios a este aviso">
          <p>Cualquier cambio se publicará en esta misma página con su fecha de actualización.</p>
        </Section>
      </article>
    </main>
  );
}
