import { randomBytes } from "node:crypto";
import { Keypair } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "../../src/crypto.ts";

const key = { key: randomBytes(32), version: 1 };
const secret = Keypair.random().secret();

describe("wallet secret encryption", () => {
  it("decrypts what it encrypted", () => {
    const encrypted = encryptSecret(secret, key, "poolfi-wallet:user-1:GABC");
    expect(encrypted.ciphertext.toString("utf8")).not.toContain(secret);
    expect(decryptSecret(encrypted, key, "poolfi-wallet:user-1:GABC")).toBe(secret);
  });

  it("uses a fresh IV every time", () => {
    const a = encryptSecret(secret, key, "ctx");
    const b = encryptSecret(secret, key, "ctx");
    expect(a.iv.equals(b.iv)).toBe(false);
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
  });

  it("refuses a secret moved to another wallet's row", () => {
    const encrypted = encryptSecret(secret, key, "poolfi-wallet:user-1:GABC");
    expect(() => decryptSecret(encrypted, key, "poolfi-wallet:user-2:GXYZ")).toThrow();
  });

  it("refuses tampered ciphertext", () => {
    const encrypted = encryptSecret(secret, key, "ctx");
    encrypted.ciphertext[0] = (encrypted.ciphertext[0] ?? 0) ^ 1;
    expect(() => decryptSecret(encrypted, key, "ctx")).toThrow();
  });

  it("refuses the wrong key or key version", () => {
    const encrypted = encryptSecret(secret, key, "ctx");
    expect(() => decryptSecret(encrypted, { key: randomBytes(32), version: 1 }, "ctx")).toThrow();
    expect(() => decryptSecret(encrypted, { key: key.key, version: 2 }, "ctx")).toThrow(/version/);
  });
});
