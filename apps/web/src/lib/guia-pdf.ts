// Guía de envío regenerada en PDF de 4×6 pulgadas (288×432 pt) para impresoras térmicas.
// El QR se dibuja con el contenido EXACTO del original (JSON con hash_code): es lo que leen las
// apps de ML y de Packatelas, así que no se reformatea ni se vuelve a serializar.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import QRCode from "qrcode";
import type { GuiaData } from "@packatelas/db";

const W = 288, H = 432, M = 12;
const BLACK = rgb(0, 0, 0);
const FECHA = new Intl.DateTimeFormat("es-MX", { timeZone: "America/Mexico_City", day: "2-digit", month: "short", year: "numeric" });
const FECHA_HORA = new Intl.DateTimeFormat("es-MX", { timeZone: "America/Mexico_City", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

/** Las fuentes estándar solo cubren WinAnsi: se quitan emojis y caracteres raros. */
const clean = (s: string | null | undefined) =>
  (s ?? "")
    .normalize("NFC")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/[^\x20-\x7E -ÿ]/g, "")
    .replace(/\s+/g, " ")
    .trim();

function wrap(text: string, font: PDFFont, size: number, width: number, maxLines: number) {
  const words = clean(text).split(" ").filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const t = line ? `${line} ${w}` : w;
    if (font.widthOfTextAtSize(t, size) <= width) line = t;
    else {
      if (line) lines.push(line);
      line = w;
      while (font.widthOfTextAtSize(line, size) > width && line.length > 1) {
        let cut = line.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(line.slice(0, cut), size) > width) cut--;
        lines.push(line.slice(0, cut));
        line = line.slice(cut);
      }
    }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    let last = kept[maxLines - 1];
    while (last.length > 1 && font.widthOfTextAtSize(`${last}…`, size) > width) last = last.slice(0, -1);
    kept[maxLines - 1] = `${last}…`;
    return kept;
  }
  return lines;
}

function drawQr(page: PDFPage, text: string, x: number, y: number, size: number) {
  const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
  const n = qr.modules.size;
  const quiet = 2;
  const cell = size / (n + quiet * 2);
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.modules.get(r, c)) page.drawRectangle({ x: x + (c + quiet) * cell, y: y + size - (r + quiet + 1) * cell, width: cell + 0.05, height: cell + 0.05, color: BLACK });
    }
  }
}

let logoBytes: Promise<Buffer | null> | null = null;
const logo = () =>
  (logoBytes ??= readFile(path.join(/* turbopackIgnore: true */ process.cwd(), "public/brand/logo-horizontal.png")).catch(() => null));

export async function guiaPdf(g: GuiaData, opts: { reprintedAt?: Date } = {}) {
  if (!g.qrRaw) throw new Error("Falta el QR original");
  const doc = await PDFDocument.create();
  doc.setTitle(`Guía ${g.shipmentId}`);
  doc.setCreator("Packatelas");
  const page = doc.addPage([W, H]);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const text = (s: string, x: number, y: number, size: number, f: PDFFont = regular) => page.drawText(clean(s), { x, y, size, font: f, color: BLACK });
  const line = (y: number) => page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.8, color: BLACK });
  const inner = W - 2 * M;

  // Encabezado
  let y = H - M;
  const png = await logo();
  if (png) {
    const img = await doc.embedPng(png);
    const h = 18, w = (img.width / img.height) * h;
    page.drawImage(img, { x: M, y: y - h, width: w, height: h });
  } else text("PACKATELAS", M, y - 15, 14, bold);
  const tag = g.logisticType === "self_service" || !g.logisticType ? "FLEX" : g.logisticType.toUpperCase();
  const tw = bold.widthOfTextAtSize(tag, 16);
  page.drawRectangle({ x: W - M - tw - 10, y: y - 20, width: tw + 10, height: 20, color: BLACK });
  page.drawText(tag, { x: W - M - tw - 5, y: y - 15, size: 16, font: bold, color: rgb(1, 1, 1) });
  y -= 26;
  line(y);

  // QR + datos del envío
  const qrSize = 132;
  y -= 4;
  drawQr(page, g.qrRaw, M - 4, y - qrSize, qrSize);
  const cx = M + qrSize + 2;
  const cw = W - M - cx;
  let ty = y - 12;
  text("Envío", cx, ty, 8);
  ty -= 17;
  const sid = g.shipmentId;
  const sidSize = Math.min(17, (cw / bold.widthOfTextAtSize(sid, 1)) * 0.98);
  text(sid, cx, ty, sidSize, bold);
  ty -= 16;
  if (g.mlOrderId) { text(`Venta: ${g.mlOrderId}`, cx, ty, 8); ty -= 11; }
  if (g.packId) { text(`Paquete: ${g.packId}`, cx, ty, 8); ty -= 11; }
  if (g.mlCreatedAt) { text(`Compra: ${FECHA.format(g.mlCreatedAt)}`, cx, ty, 8); ty -= 11; }
  if (g.estimatedDelivery) { text(`Entrega: ${FECHA.format(g.estimatedDelivery)}`, cx, ty, 8, bold); ty -= 11; }
  if (g.code) { text(`Packatelas: ${g.code}`, cx, ty, 8); ty -= 11; }
  if (g.zip) {
    ty -= 6;
    text("CP", cx, ty, 8);
    text(g.zip, cx + 14, ty - 4, 22, bold);
  }
  y -= qrSize + 4;
  line(y);

  // Destinatario
  y -= 12;
  text("DESTINATARIO", M, y, 7, bold);
  y -= 15;
  for (const l of wrap(g.recipientName ?? "—", bold, 13, inner, 2)) { text(l, M, y, 13, bold); y -= 15; }
  const who = [g.buyerNickname, g.recipientPhone ? `Tel. ${g.recipientPhone}` : null].filter(Boolean).join("  ·  ");
  if (who) { text(who, M, y + 2, 8); y -= 11; }
  y -= 2;
  for (const l of wrap(g.addressLine ?? "", bold, 11, inner, 3)) { text(l, M, y, 11, bold); y -= 13; }
  const area = [g.neighborhood, g.city, g.state, g.zip ? `CP ${g.zip}` : null].filter(Boolean).join(", ");
  for (const l of wrap(area, regular, 9, inner, 2)) { text(l, M, y, 9); y -= 11; }
  if (g.reference) {
    y -= 2;
    for (const [i, l] of wrap(`Referencia: ${g.reference}`, regular, 8, inner, 3).entries()) { text(l, M, y, 8, i === 0 ? regular : regular); y -= 10; }
  }
  y -= 2;
  line(y);

  // Productos y remitente
  y -= 11;
  if (g.itemsSummary) {
    for (const l of wrap(`Contenido: ${g.itemsSummary}`, regular, 8, inner, 2)) { text(l, M, y, 8); y -= 10; }
    y -= 2;
  }
  text("REMITENTE", M, y, 7, bold);
  y -= 11;
  text([g.sellerNickname, g.clientName].filter(Boolean).join(" · "), M, y, 9);

  // Pie
  const foot = `Guía regenerada por Packatelas · ${FECHA_HORA.format(opts.reprintedAt ?? new Date())}`;
  page.drawLine({ start: { x: M, y: M + 12 }, end: { x: W - M, y: M + 12 }, thickness: 0.5, color: BLACK });
  text(foot, M, M + 2, 6.5);
  return doc.save();
}
