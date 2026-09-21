import crypto from "node:crypto";

/**
 * AES-256-GCM encryption for tenant-held credentials at rest
 * (`integrations.credentials_encrypted` bytea).
 *
 * Values are JSON-serialized, then encrypted, and stored as raw bytes so the
 * DB column is opaque to RLS-visible queries and logs alike.
 */

const ALGO = "aes-256-gcm";
const KEY_ENV = "CREDENTIALS_ENCRYPTION_KEY";

function getKey(): Buffer {
  const hex = process.env[KEY_ENV];
  if (!hex) {
    throw new Error(`Missing ${KEY_ENV} environment variable`);
  }
  return Buffer.from(hex, "hex");
}

/** Encrypts a JSON-serializable value → byte buffer for a `bytea` column. */
export function encryptCredentials(value: unknown): Buffer {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const plaintext = Buffer.from(JSON.stringify(value), "utf-8");
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Layout: 12-byte IV || 16-byte auth tag || ciphertext
  return Buffer.concat([iv, tag, encrypted]);
}

/** Decrypts a `bytea` buffer produced by `encryptCredentials`. */
export function decryptCredentials<T>(blob: Uint8Array | Buffer): T {
  const key = getKey();
  const buf = Buffer.isBuffer(blob) ? blob : Buffer.from(blob);
  if (buf.length < 28) throw new Error("credentials blob too short");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ciphertext = buf.subarray(28);
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(plaintext.toString("utf-8")) as T;
}