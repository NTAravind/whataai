import { inngest } from "@/lib/clients/ingest";
import { mailWebhookReceived } from "@/lib/inngest/events";

export const runtime = "nodejs";

/**
 * Mail webhook (Resend) — same fast-ACK + durable Inngest pattern as the
 * WhatsApp route. Resend retries non-200s; we only accept `email.received`
 * and enqueue a normalized `mail/webhook.received` event per delivery.
 */
export async function POST(request: Request) {
  let body: { type?: string; data?: { id?: string } };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }

  if (body.type !== "email.received" || !body.data?.id) {
    // ACK unrelated event types (bounces, unsubscribes) without work.
    return new Response("OK", { status: 200 });
  }

  try {
    await inngest.send({
      id: `mail-${body.data.id}`,
      name: mailWebhookReceived.name,
      data: {
        channel: "mail",
        eventType: "message",
        providerEventId: body.data.id,
        raw: body,
      },
    });
  } catch (err) {
    console.error("inngest.send failed for mail webhook", err);
    return new Response("Enqueue failed", { status: 500 });
  }

  return new Response("OK", { status: 200 });
}
