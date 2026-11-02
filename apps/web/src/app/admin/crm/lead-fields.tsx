import { LEAD_SOURCES, type Lead } from "@packatelas/db";
import { Field, Select, TextArea } from "@/components/ui";

/** Campos del prospecto (alta y edición). */
export function LeadFields({ lead, owners }: { lead?: Partial<Lead>; owners?: { id: string; name: string }[] }) {
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Negocio" name="businessName" defaultValue={lead?.businessName ?? ""} required />
        <Field label="Contacto" name="contactName" defaultValue={lead?.contactName ?? ""} />
        <Field label="WhatsApp / teléfono" name="phone" inputMode="tel" defaultValue={lead?.phone ?? ""} />
        <Field label="Correo" name="email" type="email" defaultValue={lead?.email ?? ""} />
        <Select label="Zona" name="zone" defaultValue={lead?.zone ?? ""}>
          <option value="">Sin definir</option>
          <option value="cmx">CDMX</option>
          <option value="emx">Estado de México</option>
        </Select>
        <Field label="Envíos al mes (aprox.)" name="monthlyVolume" defaultValue={lead?.monthlyVolume ?? ""} placeholder="ej. 50-100" />
        <Field label="Dónde vende" name="salesChannels" defaultValue={lead?.salesChannels ?? ""} placeholder="MercadoLibre, Tiendanube, redes…" />
        <Select label="Cómo llegó" name="source" defaultValue={lead?.source ?? "MANUAL"}>
          {LEAD_SOURCES.map((s) => (
            <option key={s.key} value={s.key}>{s.label}</option>
          ))}
        </Select>
        {owners && (
          <Select label="Responsable" name="ownerId" defaultValue={lead?.ownerId ?? ""}>
            <option value="">Sin asignar</option>
            {owners.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </Select>
        )}
      </div>
      <TextArea label="Notas" name="notes" rows={3} defaultValue={lead?.notes ?? ""} />
    </>
  );
}
