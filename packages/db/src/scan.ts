// Lectura del contenido de un código escaneado (QR de etiqueta ML, código propio o número suelto).

export type ScanResult =
  | { kind: "ML"; shipmentId: bigint; senderId: bigint | null }
  | { kind: "CODE"; code: string }
  | { kind: "INVALID"; reason: string };

const ML_ID = /^\d{10,13}$/;
const OWN_CODE = /^(PK|RC|DV|IN)-\d{4,}$/i;

/**
 * Limpia lo que llega de lectores que «teclean» (iPad/iPhone con puntuación inteligente cambian
 * " por “ ”, algunos teclados mandan ″ o comillas latinas) y quita caracteres invisibles.
 */
export function normalizeScan(raw: string): string {
  return String(raw ?? "")
    .replace(/[\u200B-\u200D\uFEFF\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/[“”„‟″«»]/g, '"')
    .replace(/[‘’‚‛′]/g, "'")
    .trim();
}

/**
 * Las etiquetas de Mercado Envíos traen un QR con JSON, p. ej.
 * {"id":"46972264194","sender_id":123456789,"hash_code":"…","security_digit":"0"}.
 * Algunos lectores PDA entregan solo el número del envío.
 */
export function parseScan(raw: string): ScanResult {
  const text = normalizeScan(raw);
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
      // Lectura cortada o con caracteres cambiados por el teclado: se rescatan el envío y el vendedor.
      const id = text.match(/\bid\W{1,4}(\d{10,13})\b/)?.[1];
      if (!id) return { kind: "INVALID", reason: "QR ilegible" };
      const sender = text.match(/(?:sender|seller)_id\W{1,4}(\d{3,15})\b/)?.[1];
      return { kind: "ML", shipmentId: BigInt(id), senderId: sender ? BigInt(sender) : null };
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
