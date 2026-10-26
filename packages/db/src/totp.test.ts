import { describe, expect, it } from "vitest";
import { base32Decode, base32Encode, generateTotpSecret, totpCode, verifyTotp } from "./totp.ts";
import { decryptSecret, encryptSecret } from "./crypto.ts";

describe("TOTP", () => {
  // Vector de prueba del RFC 6238 (SHA1, secreto "12345678901234567890")
  const secret = base32Encode(Buffer.from("12345678901234567890"));
  it("coincide con el RFC 6238", () => {
    expect(totpCode(secret, 1, 8)).toBe("94287082"); // T = 59 s
    expect(totpCode(secret, Math.floor(1111111109 / 30), 8)).toBe("07081804");
    expect(base32Decode(secret).toString()).toBe("12345678901234567890");
  });
  it("acepta ±30 s y no acepta el mismo código dos veces", () => {
    const s = generateTotpSecret();
    const now = 1_800_000_000_000;
    const step = Math.floor(now / 30000);
    const code = totpCode(s, step);
    expect(verifyTotp(s, code, { now })).toBe(step);
    expect(verifyTotp(s, code, { now: now + 30000 })).toBe(step);
    expect(verifyTotp(s, code, { now: now + 90000 })).toBeNull();
    expect(verifyTotp(s, code, { now, lastStep: step })).toBeNull();
    expect(verifyTotp(s, "12345", { now })).toBeNull();
  });
});

describe("cifrado de secretos", () => {
  it("cifra y descifra; detecta alteraciones", () => {
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
    const enc = encryptSecret("JBSWY3DPEHPK3PXP");
    expect(enc).not.toContain("JBSWY3DPEHPK3PXP");
    expect(decryptSecret(enc)).toBe("JBSWY3DPEHPK3PXP");
    const parts = enc.split(".");
    parts[3] = parts[3].slice(0, -2) + (parts[3].endsWith("A") ? "BB" : "AA");
    expect(() => decryptSecret(parts.join("."))).toThrow();
  });
});
