import { missingEmployeeData, prisma } from "@packatelas/db";
import { ActionForm } from "@/components/action-form";
import { saveMyDataAction } from "@/app/mis-datos/actions";

const F = ({ label, name, v, ...rest }: { label: string; name: string; v: string | null | undefined } & React.ComponentProps<"input">) => (
  <label className="block text-sm">
    <span className="font-medium text-slate-700">{label}</span>
    <input name={name} defaultValue={v ?? ""} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-base" {...rest} />
  </label>
);

/** Datos del expediente que llena la propia persona (CURP, RFC, NSS, domicilio, CLABE, emergencia). */
export async function MyData({ userId }: { userId: string }) {
  const e = await prisma.employee.findUnique({ where: { userId }, select: { employeeNo: true, name: true, rfc: true, curp: true, nss: true, phone: true, email: true, address: true, bank: true, clabe: true, emergency: true } });
  if (!e) return null;
  const missing = missingEmployeeData(e);
  const em = (e.emergency ?? {}) as { name?: string; phone?: string; relation?: string };
  return (
    <section id="expediente" className="scroll-mt-20 rounded-2xl border border-slate-200 bg-white p-4">
      <h2 className="font-semibold">Mis datos de expediente</h2>
      <p className="text-xs text-slate-500">Empleado #{e.employeeNo} · {e.name}</p>
      {missing.length > 0 && <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">Te falta: {missing.join(", ")}.</p>}
      <ActionForm action={saveMyDataAction} submitLabel="Guardar mis datos" className="mt-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <F label="Celular" name="phone" v={e.phone} inputMode="tel" autoComplete="tel" />
          <F label="Correo (opcional)" name="email" v={e.email} type="email" autoComplete="email" />
          <F label="CURP" name="curp" v={e.curp} maxLength={18} autoCapitalize="characters" />
          <F label="RFC con homoclave" name="rfc" v={e.rfc} maxLength={13} autoCapitalize="characters" />
          <F label="NSS (IMSS)" name="nss" v={e.nss} maxLength={11} inputMode="numeric" />
          <F label="Banco" name="bank" v={e.bank} />
          <F label="CLABE para tu nómina" name="clabe" v={e.clabe} maxLength={18} inputMode="numeric" />
        </div>
        <F label="Domicilio (calle, número, colonia, alcaldía/municipio, CP)" name="address" v={e.address} autoComplete="street-address" />
        <fieldset className="grid gap-3 sm:grid-cols-3">
          <legend className="mb-1 text-sm font-medium text-slate-700">Contacto de emergencia</legend>
          <F label="Nombre" name="emergencyName" v={em.name} />
          <F label="Teléfono" name="emergencyPhone" v={em.phone} inputMode="tel" />
          <F label="Parentesco" name="emergencyRelation" v={em.relation} />
        </fieldset>
      </ActionForm>
    </section>
  );
}
