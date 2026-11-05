// QR del llavero de cada moto. Mismo contenido que en la app de flotilla anterior
// («FLOTILLA:M-01»), así que los llaveros ya impresos siguen sirviendo.
export const vehicleQrText = (code: string) => `FLOTILLA:${code}`;

/** Folio de la moto a partir de lo escaneado: acepta «FLOTILLA:M-01», «M-01» o «m01». */
export function parseVehicleQr(raw: string): string | null {
  const s = raw.trim().toUpperCase().replace(/^FLOTILLA:/, "");
  const m = s.match(/^M-?([A-Z0-9]{1,6})$/);
  return m ? `M-${m[1]}` : null;
}
