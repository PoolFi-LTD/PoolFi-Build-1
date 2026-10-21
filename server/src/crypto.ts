import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export interface EncryptedSecret {
  ciphertext: Buffer;
  iv: Buffer;
  tag: Buffer;
  keyVersion: number;
}

export interface EncryptionKey {
  key: Buffer;
  version: number;
}

/**
 * Encrypts a wallet secret with AES-256-GCM. `context` is bound to the
 * ciphertext as additional data, so a secret copied onto another wallet's row
 * fails to decrypt.
 */
export function encryptSecret(secret: string, { key, version }: EncryptionKey, context: string): EncryptedSecret {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(context));
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return { ciphertext, iv, tag: cipher.getAuthTag(), keyVersion: version };
}

export function decryptSecret(encrypted: EncryptedSecret, { key, version }: EncryptionKey, context: string): string {
  if (encrypted.keyVersion !== version) {
    throw new Error(`Wallet secret uses encryption key version ${encrypted.keyVersion}, but version ${version} is loaded`);
  }
  const decipher = createDecipheriv("aes-256-gcm", key, encrypted.iv);
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(encrypted.tag);
  return Buffer.concat([decipher.update(encrypted.ciphertext), decipher.final()]).toString("utf8");
}
