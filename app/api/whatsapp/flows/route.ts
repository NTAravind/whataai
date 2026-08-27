import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { inngest } from "@/lib/clients/ingest";
import { flowDataExchange } from "@/lib/inngest/events";
import {
  decryptFlowRequest,
  encryptFlowResponse,
  FlowDecryptionError,
} from "@/lib/crypto/whatsapp-crypto";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * WhatsApp Flows endpoint (docs/api-guide.md "FLOW ENDPOINT").
 *
 * Meta POSTs an encrypted envelope and waits synchronously for an encrypted
 * reply. We decrypt, journal the exchange into Inngest for durability, and
 * answer from the last committed screen. Any decryption failure returns 421
 * so the Flow client re-fetches our public key.
 */
export async function POST(request: Request) {
  let envelope: { encrypted_flow_data: string; encrypted_aes_key: string; initial_vector: string };
  try {
    envelope = (await request.json()) as typeof envelope;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  let aesKey: Buffer;
  let iv: Buffer;
  let payload: ReturnType<typeof decryptFlowRequest>["payload"];
  try {
    const decrypted = decryptFlowRequest(envelope);
    payload = decrypted.payload;
    aesKey = decrypted.aesKey;
    iv = decrypted.iv;
  } catch (err) {
    if (err instanceof FlowDecryptionError) {
      return new Response("Decryption failed", { status: 421 });
    }
    throw err;
  }

  // Journal the exchange; the function commits the state transition and any
  // completion side-effects (booking creation) durably.
  try {
    const eventFingerprint = createHash("sha256")
      .update(JSON.stringify({ action: payload.action, screen: payload.screen, data: payload.data }))
      .digest("hex");
    await inngest.send({
      id: `flow-${payload.flow_token ?? ""}-${eventFingerprint}`,
      name: flowDataExchange.name,
      data: {
        flowToken: payload.flow_token ?? "",
        action: payload.action as "INIT" | "data_exchange" | "BACK" | "ping" | "error",
        screen: payload.screen,
        data: payload.data,
      },
    });
  } catch (err) {
    console.error("inngest.send failed for flow exchange", err);
  }

  // Synchronous reply: acknowledge the action; the Flow engine drives the
  // screens client-side via the flow's JSON screen definitions.
  const reply = {
    version: payload.version,
    screen: payload.screen ?? "loading",
    data: {},
  };

  return new Response(encryptFlowResponse(reply, aesKey, iv), {
    status: 200,
    headers: { "Content-Type": "text/plain" },
  });
}
