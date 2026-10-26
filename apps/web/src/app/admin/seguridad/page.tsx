import type { Metadata } from "next";
import QRCode from "qrcode";
import { encryptSecret, generateTotpSecret, otpauthUri, prisma } from "@packatelas/db";
import { requireUser } from "@/lib/auth";
import { STAFF_ROLES } from "@/lib/roles";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, PageHeader } from "@/components/ui";
import { disableTwoFactor, enableTwoFactor } from "./actions";

export const metadata: Metadata = { title: "Seguridad" };

const codeInput = "w-40 rounded-lg border border-slate-300 px-3 py-2 text-center font-mono text-lg tracking-widest";

export default async function SeguridadPage() {
  const user = await requireUser(STAFF_ROLES);
  const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { totpSecret: true } });
  const enabled = !!row.totpSecret;

  let setup: { qr: string; secret: string; pending: string } | null = null;
  if (!enabled) {
    const secret = generateTotpSecret();
    setup = {
      secret,
      qr: await QRCode.toString(otpauthUri(secret, user.username), { type: "svg", margin: 1 }),
      pending: encryptSecret(secret),
    };
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader eyebrow="Mi cuenta" title="Seguridad">
        La verificación en dos pasos pide, además de la contraseña, un código de 6 dígitos de una app en tu teléfono.
      </PageHeader>
      <Card title="Verificación en dos pasos" actions={enabled ? <Badge tone="green">Activa</Badge> : <Badge tone="amber">Inactiva</Badge>}>
        {enabled ? (
          <ActionForm action={disableTwoFactor} submitLabel="Desactivar">
            <p className="text-sm text-slate-600">Para desactivarla escribe el código actual de tu app.</p>
            <input name="code" inputMode="numeric" maxLength={6} required aria-label="Código" className={codeInput} />
          </ActionForm>
        ) : (
          setup && (
            <ActionForm action={enableTwoFactor} submitLabel="Activar">
              <ol className="list-decimal space-y-2 pl-5 text-sm text-slate-700">
                <li>Instala Google Authenticator, Microsoft Authenticator o 1Password en tu teléfono.</li>
                <li>Agrega una cuenta escaneando este código:</li>
              </ol>
              <div className="w-48" dangerouslySetInnerHTML={{ __html: setup.qr }} />
              <p className="text-xs text-slate-500">
                ¿No puedes escanear? Escribe esta clave: <span className="select-all font-mono text-slate-800">{setup.secret.match(/.{1,4}/g)?.join(" ")}</span>
              </p>
              <input type="hidden" name="pending" value={setup.pending} />
              <label className="block text-sm text-slate-700">
                3. Escribe el código que muestra la app
                <input name="code" inputMode="numeric" maxLength={6} required className={`mt-1 block ${codeInput}`} />
              </label>
            </ActionForm>
          )
        )}
      </Card>
      <p className="text-xs text-slate-500">
        Si pierdes el teléfono, otro administrador puede quitarte la verificación desde Usuarios para que la vuelvas a activar.
      </p>
    </div>
  );
}
