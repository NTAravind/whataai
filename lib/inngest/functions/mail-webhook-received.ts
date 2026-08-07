import { inngest } from "@/lib/clients/ingest";
import { mailWebhookReceived, messageInbound } from "@/lib/inngest/events";
import { supabaseAdmin } from "@/lib/clients/supabase";
import { mailAdapter } from "@/lib/channels/mail.adapter";
import { getOrCreateContact } from "@/lib/services/contacts";
import { getOrCreateConversation, pickAgentForConversation } from "@/lib/services/conversations";
import { recordInboundMessage } from "@/lib/services/messages";

/**
 * Mail webhook ingest — mirrors the WhatsApp ingest function (docs/guide.md
 * §7). Resolves the tenant/mail account by the recipient address, then feeds
 * the same channel-agnostic `message/inbound` orchestration.
 */
export const mailWebhookIngest = inngest.createFunction(
  {
    id: "mail-webhook-ingest",
    name: "Mail Webhook Ingest",
    triggers: [mailWebhookReceived],
    idempotency: "event.data.providerEventId",
    retries: 4,
  },
  async ({ event, step, runId, logger }) => {
    const d = event.data;

    const claimed = await step.run("claim-webhook-event", async () => {
      const { data, error } = await supabaseAdmin()
        .from("webhook_events")
        .upsert(
          {
            channel: "mail",
            event_type: d.eventType,
            provider_event_id: d.providerEventId,
            tenant_id: d.tenantId ?? null,
            payload: d.raw as Record<string, unknown>,
            status: "processing",
            inngest_run_id: runId,
          },
          { onConflict: "channel,event_type,provider_event_id" },
        )
        .select("status")
        .single();
      if (error) throw error;
      return data.status;
    });

    if (claimed === "processed") {
      return { skipped: true, reason: "already processed" };
    }

    const parsed = await step.run("normalize-payload", () => mailAdapter.parseWebhook(d.raw));
    if (!parsed.messages.length) {
      await step.run("mark-processed", () =>
        supabaseAdmin()
          .from("webhook_events")
          .update({ status: "processed", processed_at: new Date().toISOString() })
          .eq("channel", "mail")
          .eq("event_type", "message")
          .eq("provider_event_id", d.providerEventId),
      );
      return { skipped: true, reason: "no parseable messages" };
    }

    for (const msg of parsed.messages) {
      const outcome = (await step.run(`process-message-${msg.providerMessageId}`, async () => {
        // Resolve the mail account by the recipient address (the "to" that
        // Resend delivers to == our mail_accounts.email_address).
        const to = (msg.content.meta as { to?: string } | undefined)?.to ?? "";
        const { data: mailAccount, error: mailErr } = await supabaseAdmin()
          .from("mail_accounts")
          .select("id, tenant_id")
          .eq("email_address", to)
          .maybeSingle();
        if (mailErr || !mailAccount) {
          return { ok: false, reason: `no mail_account for ${to}` };
        }
        const tenantId = mailAccount.tenant_id;

        const contact = await getOrCreateContact(tenantId, msg.senderId, null);

        const agent = await pickAgentForConversation({
          tenantId,
          channel: "mail",
          channelAccountId: mailAccount.id,
        });

        const conversation = await getOrCreateConversation({
          tenantId,
          contactId: contact.id,
          channel: "mail",
          channelAccountId: mailAccount.id,
          senderId: msg.senderId,
          agentId: agent?.id ?? null,
        });

        await recordInboundMessage({
          conversationId: conversation.id,
          content: { type: "text", text: msg.content.text ?? "", meta: msg.content.meta },
          providerMessageId: msg.providerMessageId,
        });

        return {
          ok: true,
          tenantId: mailAccount.tenant_id,
          mailAccountId: mailAccount.id,
          conversationId: conversation.id,
          contactId: contact.id,
        };
      })) as
        | { ok: false; reason: string }
        | { ok: true; tenantId: string; mailAccountId: string; conversationId: string; contactId: string };

      if (!outcome.ok) {
        logger.info("mail message skipped", { reason: outcome.reason });
        continue;
      }

      await step.sendEvent("emit-message-inbound", {
        name: messageInbound.name,
        data: {
          tenantId: outcome.tenantId,
          channel: "mail",
          channelAccountId: outcome.mailAccountId,
          providerMessageId: msg.providerMessageId,
          conversationId: outcome.conversationId,
          contactId: outcome.contactId,
          senderId: msg.senderId,
          content: { type: "text", text: msg.content.text ?? "", meta: msg.content.meta },
          receivedAt: msg.receivedAt,
        },
        meta: { sessions: { conversation_id: outcome.conversationId } },
      });
    }

    await step.run("mark-processed", () =>
      supabaseAdmin()
        .from("webhook_events")
        .update({ status: "processed", processed_at: new Date().toISOString() })
        .eq("channel", "mail")
        .eq("event_type", "message")
        .eq("provider_event_id", d.providerEventId),
    );

    return { processed: parsed.messages.length };
  },
);
