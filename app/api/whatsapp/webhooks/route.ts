import { inngest } from "@/lib/clients/ingest";
import { whatsappWebhookReceived } from "@/lib/inngest/events";
import { verifyMetaSignature } from "@/lib/crypto/whatsapp-crypto";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * WhatsApp webhook — fast-ACK at the edge, durable work in Inngest.
 *
 * Meta retries anything that isn't a 200 within a few seconds, so this route
 * only validates the signature, builds idempotent event ids, and enqueues
 * `whatsapp/webhook.received` per change. All real work happens in
 * `lib/inngest/functions/whatsapp-webhook-received.ts` (claim table +
 * contact/conversation upsert + fan-out to `message/inbound`).
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;

  if (mode === "subscribe" && token && (token === VERIFY_TOKEN || (await matchesAccountVerifyToken(token)))) {
    return new Response(challenge, { status: 200 });
  }

  return new Response("Forbidden", { status: 403 });
}

/** Accept a verify token that any tenant's wa_account was configured with. */
async function matchesAccountVerifyToken(token: string): Promise<boolean> {
  try {
    const { matchWaVerifyToken } = await import("@/lib/services/wa-accounts");
    return await matchWaVerifyToken(token);
  } catch (err) {
    console.error("webhook verify-token lookup failed", err);
    return false;
  }
}

export async function POST(request: Request) {
  const rawBody = await request.text();

  // Strict mode: reject unauthenticated payloads.
  if (process.env.META_APP_SECRET && !verifyMetaSignature(rawBody, request.headers.get("x-hub-signature-256"))) {
    return new Response("Signature mismatch", { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }

  const entries = (body.entry ?? []) as {
    changes?: { field?: string; value?: Record<string, unknown> }[];
  }[];

  const events: Array<{ id: string; name: string; data: unknown }> = [];

  for (const entry of entries) {
    for (const change of entry.changes ?? []) {
      const value = change.value ?? {};

      // ---- inbound messages + delivery statuses ---------------------------
      if (change.field === "messages") {
        for (const message of (value.messages as { id?: string }[]) ?? []) {
          if (!message.id) continue;
          events.push({
            id: `wa-msg-${message.id}`,
            name: whatsappWebhookReceived.name,
            data: {
              channel: "whatsapp",
              eventType: "message",
              providerEventId: message.id,
              raw: body,
            },
          });
        }

        for (const status of (value.statuses as { id?: string; status?: string }[]) ?? []) {
          if (!status.id) continue;
          const statusKey = status.status ?? "unknown";
          events.push({
            id: `wa-status-${status.id}-${statusKey}`,
            name: whatsappWebhookReceived.name,
            data: {
              channel: "whatsapp",
              eventType: "status",
              providerEventId: `${status.id}-${statusKey}`,
              raw: body,
            },
          });
        }
      }

      // ---- template approval/quality webhooks -----------------------------
      if (change.field === "message_template_status_update") {
        const v = value as { event?: string; message_template_id?: string };
        if (v.event !== "MESSAGE_TEMPLATE_STATUS_UPDATE") continue;
        if (!v.message_template_id) continue;
        events.push({
          id: `wa-template-${v.message_template_id}`,
          name: whatsappWebhookReceived.name,
          data: {
            channel: "whatsapp",
            eventType: "template",
            providerEventId: v.message_template_id,
            raw: { id: (entry as { id?: string }).id, changes: [change] },
          },
        });
      }
    }
  }

  if (events.length) {
    try {
      await inngest.send(events);
    } catch (err) {
      // Best-effort: fail the request so Meta retries rather than losing it.
      console.error("inngest.send failed for whatsapp webhook", err);
      return new Response("Enqueue failed", { status: 500 });
    }
  }

  // Always ACK fast — Meta's timeout is seconds, Inngest is durable.
  return new Response("OK", { status: 200 });
}
