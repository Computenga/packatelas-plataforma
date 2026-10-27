import { describe, expect, it } from "vitest";
import { parseFondeadoraDeposit } from "@packatelas/db";
import { extractText, isAuthenticFondeadora } from "./gmail.ts";

const enc = (s: string) => Buffer.from(s, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_");

describe("extractText", () => {
  it("prefiere text/plain en correos multiparte", () => {
    const t = extractText({
      mimeType: "multipart/alternative",
      parts: [
        { mimeType: "text/plain", body: { data: enc("Recibiste un depósito\n\nX depositó $10.00 a tu cuenta por el concepto de cmx00001.\n\nClave de rastreo: ABC123.") } },
        { mimeType: "text/html", body: { data: enc("<p>ignorar</p>") } },
      ],
    });
    expect(parseFondeadoraDeposit(t)?.trackingKey).toBe("ABC123");
  });

  it("si solo hay HTML, lo convierte a texto que el lector entiende", () => {
    const html = `<style>p{}</style><div><span>Recibiste un depósito</span></div>
      <div><span>EMPRESA DEMO depositó $2,288.00 a tu cuenta  por el concepto de packatelas CMX00136.  </span></div>
      <div><span><br>Clave de rastreo: CPO184365690835.<br></span></div>`;
    const t = extractText({ mimeType: "text/html", body: { data: enc(html) } });
    expect(parseFondeadoraDeposit(t)).toMatchObject({ amount: "2288.00", concept: "packatelas CMX00136", trackingKey: "CPO184365690835" });
  });
});

describe("whatsappSender", () => {
  it("sin credenciales no hay envío", async () => {
    const { whatsappSender } = await import("./whatsapp.ts");
    expect(whatsappSender({})).toBeNull();
    expect(whatsappSender({ WHATSAPP_TOKEN: "x", WHATSAPP_PHONE_ID: "1" })).toBeTypeOf("function");
  });
});

describe("autenticidad del correo de Fondeadora", () => {
  const ok = [
    { name: "From", value: "Fondeadora Negocios <info@negocios.fondeadora.com>" },
    { name: "Authentication-Results", value: "mx.google.com;\r\n       dkim=pass header.i=@negocios.fondeadora.com header.s=s1 header.b=TqL8oMSl;\r\n       spf=pass; dmarc=pass (p=NONE sp=NONE dis=NONE) header.from=negocios.fondeadora.com" },
  ];
  it("acepta DKIM válido de fondeadora.com verificado por Gmail", () => {
    expect(isAuthenticFondeadora(ok)).toBe(true);
  });
  it("rechaza remitente falso, DKIM de otro dominio o resultado inyectado por terceros", () => {
    expect(isAuthenticFondeadora([ok[0], { name: "Authentication-Results", value: "mx.google.com; dkim=fail header.i=@negocios.fondeadora.com; dmarc=fail" }])).toBe(false);
    expect(isAuthenticFondeadora([ok[0], { name: "Authentication-Results", value: "mx.google.com; dkim=pass header.i=@fondeadora.com.attacker.mx" }])).toBe(false);
    expect(isAuthenticFondeadora([ok[0], { name: "Authentication-Results", value: "evil.example; dkim=pass header.i=@negocios.fondeadora.com" }])).toBe(false);
    expect(isAuthenticFondeadora([{ name: "From", value: "otro@gmail.com" }, ok[1]])).toBe(false);
    expect(isAuthenticFondeadora([])).toBe(false);
  });
});
