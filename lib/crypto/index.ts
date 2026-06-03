import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "@/lib/env";

/**
 * App-level AES-256-GCM encryption for Plaid access tokens at rest.
 *
 * The key comes from TOKEN_ENC_KEY (base64-encoded 32 bytes). Each ciphertext
 * is self-describing: we store iv:authTag:ciphertext (all base64, colon-joined)
 * so a single string round-trips through the DB `access_token_enc` column.
 *
 * NOTE: tokens must never be logged or placed in any future LLM prompt.
 */

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12; // 96-bit nonce, recommended for GCM

function getKey(): Buffer {
  const key = Buffer.from(env().TOKEN_ENC_KEY, "base64");
  if (key.length !== 32) {
    throw new Error("TOKEN_ENC_KEY must decode to exactly 32 bytes");
  }
  return key;
}

/** Encrypt a UTF-8 plaintext string. Returns "iv:authTag:ciphertext" (base64 parts). */
export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString("base64"), authTag.toString("base64"), ciphertext.toString("base64")].join(
    ":",
  );
}

/** Decrypt a string produced by `encrypt`. Throws if tampered (GCM auth failure). */
export function decrypt(payload: string): string {
  const parts = payload.split(":");
  if (parts.length !== 3) {
    throw new Error("Malformed ciphertext: expected iv:authTag:ciphertext");
  }
  const [ivB64, tagB64, dataB64] = parts as [string, string, string];
  const key = getKey();
  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(tagB64, "base64");
  const ciphertext = Buffer.from(dataB64, "base64");

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
