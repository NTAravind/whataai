// Implements the encrypt/decrypt contract described under
// "WHATSAPP FLOW — FLOW ENDPOINT" in api-guide.md:
//   - inbound body: { encrypted_flow_data, encrypted_aes_key, initial_vector }
//   - AES key is RSA-OAEP(SHA-256) encrypted with our public key
//   - flow data is AES-256-GCM encrypted with that AES key + IV
//   - outbound: base64(AES-GCM(response, aesKey, flippedIV)), Content-Type: text/plain
//   - decryption failure -> caller must return HTTP 421

import crypto from "node:crypto";

export class FlowDecryptionError extends Error {}

export interface DecryptedFlowRequest {
  version: string;
  action: "INIT" | "data_exchange" | "BACK" | "ping";
  screen?: string;
  flow_token?: string;
  data?: Record<string, unknown>;
  flow_token_signature?: string;
}

interface EncryptedEnvelope {
  encrypted_flow_data: string;
  encrypted_aes_key: string;
  initial_vector: string;
}

/** Decrypts the inbound Flow envelope and returns the AES key/IV alongside the payload, since the response must be encrypted with the same key and a bit-flipped IV. */
export function decryptFlowRequest(envelope: EncryptedEnvelope): {
  payload: DecryptedFlowRequest;
  aesKey: Buffer;
  iv: Buffer;
} {
  try {
    const privateKey = crypto.createPrivateKey({
      key: process.env.FLOW_PRIVATE_KEY_PEM!,
      passphrase: process.env.FLOW_PRIVATE_KEY_PASSPHRASE!,
    });

    const aesKey = crypto.privateDecrypt(
      {
        key: privateKey,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: "sha256",
      },
      Buffer.from(envelope.encrypted_aes_key, "base64"),
    );

    const iv = Buffer.from(envelope.initial_vector, "base64");
    const flowDataBuffer = Buffer.from(envelope.encrypted_flow_data, "base64");

    // Last 16 bytes are the GCM auth tag.
    const authTag = flowDataBuffer.subarray(flowDataBuffer.length - 16);
    const encryptedBody = flowDataBuffer.subarray(0, flowDataBuffer.length - 16);

    const decipher = crypto.createDecipheriv("aes-128-gcm", aesKey, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(encryptedBody), decipher.final()]);

    return { payload: JSON.parse(decrypted.toString("utf-8")), aesKey, iv };
  } catch (err) {
    // Per spec: any decryption failure must surface as HTTP 421 so the
    // client re-fetches our public key (key rotation safety net).
    throw new FlowDecryptionError(err instanceof Error ? err.message : "decryption failed");
  }
}

/** Encrypts a response payload for the Flow client using the request's AES key and a flipped IV, returning base64 text for the raw HTTP body. */
export function encryptFlowResponse(payload: unknown, aesKey: Buffer, iv: Buffer): string {
  const flippedIv = Buffer.from(iv.map((b) => b ^ 0xff));
  const cipher = crypto.createCipheriv("aes-128-gcm", aesKey, flippedIv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf-8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([encrypted, authTag]).toString("base64");
}

/** Validates the `X-Hub-Signature-256` header Meta sends on every incoming request (webhook + Flow endpoint). */
export function verifyMetaSignature(rawBody: string, signatureHeader: string | null): boolean {
  if (!signatureHeader) return false;
  const expected =
    "sha256=" + crypto.createHmac("sha256", process.env.META_APP_SECRET!).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}