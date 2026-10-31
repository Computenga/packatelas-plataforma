// Lectura del contenido de un código escaneado (QR de etiqueta ML, código propio o número suelto).

export type ScanResult =
  | { kind: "ML"; shipmentId: bigint; senderId: bigint | null }
  | { kind: "CODE"; code: string }
  | { kind: "INVALID"; reason: string };

const ML_ID = /^\d{10,13}$/;
const OWN_CODE = /^(PK|RC)-\d{4,}$/i;

/**
 * Las etiquetas de Mercado Envíos traen un QR con JSON, p. ej.
 * {"id":"46972264194","sender_id":123456789,"hash_code":"…","security_digit":"0"}.
 * Algunos lectores PDA entregan solo el número del envío.
 */
export function parseScan(raw: string): ScanResult {
  const text = raw.trim();
  if (!text) return { kind: "INVALID", reason: "Lectura vacía" };

  if (text.startsWith("{")) {
    try {
      const data = JSON.parse(text) as Record<string, unknown>;
      const id = String(data.id ?? data.shipment_id ?? "");
      if (!ML_ID.test(id)) return { kind: "INVALID", reason: "El QR no trae un número de envío válido" };
      const sender = data.sender_id ?? data.seller_id;
      const senderId = sender != null && /^\d+$/.test(String(sender)) ? BigInt(String(sender)) : null;
      return { kind: "ML", shipmentId: BigInt(id), senderId };
    } catch {
      return { kind: "INVALID", reason: "QR ilegible" };
    }
  }

  const upper = text.toUpperCase();
  if (OWN_CODE.test(upper)) return { kind: "CODE", code: upper };
  if (upper.startsWith("ML-") && ML_ID.test(upper.slice(3))) {
    return { kind: "ML", shipmentId: BigInt(upper.slice(3)), senderId: null };
  }
  if (ML_ID.test(text)) return { kind: "ML", shipmentId: BigInt(text), senderId: null };

  return { kind: "INVALID", reason: "Código no reconocido" };
}
