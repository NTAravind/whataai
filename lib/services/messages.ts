import { supabaseAdmin } from "@/lib/clients/supabase";
import { inngest } from "@/lib/clients/ingest";
import { messageOutboundSend } from "@/lib/inngest/events";

export interface OutboundInput {
  tenantId: string;
  channel: "whatsapp" | "mail";
  channelAccountId: string;
  conversationId?: string;
  contactId: string;
  senderId: string;
  content: { type: "text" | "template" | "flow"; text?: string; meta?: Record<string, unknown> };
  templateId?: string;
  agentId?: string | null;
}

/**
 * Enqueue a durable outbound send.
 *
 * The messages row is inserted here (returns immediately to the caller) and
 * the `message/outbound.send` event carries a unique event `id` so Inngest
 * dedupes at-least-once redelivery within 24h. The actual Meta/Resend call
 * happens in `lib/inngest/functions/outbound-message.ts`.
 */
export async function enqueueOutboundMessage(input: OutboundInput) {
  const admin = supabaseAdmin();

  const { data: message, error } = await admin
    .from("messages")
    .insert({
      conversation_id: input.conversationId ?? null,
      role: "assistant",
      content: input.content as unknown as Record<string, unknown>,
      status: "queued",
    })
    .select()
    .single();
  if (error) throw error;

  try {
    await inngest.send({
      // Unique event id = idempotency key (Inngest dedupes duplicates <24h).
      id: `outbound-${message.id}`,
      name: messageOutboundSend.name,
      data: {
        tenantId: input.tenantId,
        channel: input.channel,
        channelAccountId: input.channelAccountId,
        conversationId: input.conversationId,
        contactId: input.contactId,
        senderId: input.senderId,
        content: input.content,
        templateId: input.templateId,
        messageId: message.id,
        agentId: input.agentId ?? null,
      },
    });
  } catch (err) {
    await admin
      .from("messages")
      .update({ status: "failed", error: { reason: "inngest_send_failed", detail: String(err) } })
      .eq("id", message.id);
    throw err;
  }

  return message;
}

export async function updateMessageStatus(messageId: string, patch: { status: string; error?: Record<string, unknown> | null }) {
  return supabaseAdmin()
    .from("messages")
    .update({ status: patch.status, error: patch.error ?? null })
    .eq("id", messageId);
}

export async function recordInboundMessage(input: {
  conversationId: string;
  content: { type: string; text?: string; meta?: Record<string, unknown> };
  providerMessageId?: string | null;
  waMessageId?: string | null;
}) {
  const admin = supabaseAdmin();
  const { data, error } = await admin
    .from("messages")
    .insert({
      conversation_id: input.conversationId,
      role: "user",
      content: input.content as unknown as Record<string, unknown>,
      wa_message_id: input.waMessageId ?? input.providerMessageId ?? null,
      status: "delivered",
    })
    .select()
    .single();
  if (error) throw error;

  await admin
    .from("conversations")
    .update({ last_message_at: new Date().toISOString(), last_inbound_at: new Date().toISOString() })
    .eq("id", input.conversationId);

  return data;
}
