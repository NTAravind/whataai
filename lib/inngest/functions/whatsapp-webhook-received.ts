import { inngest } from "@/lib/clients/ingest";
import { whatsappWebhookReceived, messageInbound } from "@/lib/inngest/events";
import { supabaseAdmin } from "@/lib/clients/supabase";
import { whatsappAdapter } from "@/lib/channels/whatsapp.adapter";
import { getOrCreateContact, setOptOut } from "@/lib/services/contacts";
import { getOrCreateConversation, pickAgentForConversation } from "@/lib/services/conversations";
import { recordInboundMessage } from "@/lib/services/messages";
import { applyTemplateStatusUpdate } from "@/lib/services/templates";

/**
 * Durable WhatsApp webhook ingest (docs/guide.md §7).
 *
 * Fast-ACK happened at the route; everything real happens here:
 *   1. claim the webhook event (idempotency table)
 *   2. normalize the payload via the channel adapter
 *   3. upsert contact + conversation + inbound message row
 *   4. fan out to `message/inbound` for the agent orchestration function
 *
 * Idempotency: function-level `idempotency` key + unique event ids from the
 * route + the webhook_events claim table (24h+ belt and braces).
 */
export const whatsappWebhookIngest = inngest.createFunction(
  {
    id: "whatsapp-webhook-ingest",
    name: "WhatsApp Webhook Ingest",
    triggers: [whatsappWebhookReceived],
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
            channel: "whatsapp",
            event_type: d.eventType,
            provider_event_id: d.providerEventId,
            tenant_id: d.tenantId ?? null,
            payload: d.raw as Record<string, unknown>,
            status: "processing",
            inngest_run_id: runId,
          },
          { onConflict: "channel,event_type,provider_event_id" },
        )
        .select("status, tenant_id")
        .single();

      if (error) throw error;
      return { status: data.status, tenantId: data.tenant_id };
    });

    if (claimed.status === "processed") {
      logger.info("webhook event already processed", { providerEventId: d.providerEventId });
      return { skipped: true };
    }

    const parsed = await step.run("normalize-payload", () =>
      whatsappAdapter.parseWebhook(d.raw),
    );

    // ---- template status updates (message_template_status_update field) ----
    if (d.eventType === "template") {
      const updated = await step.run("apply-template-status", async () => {
        const raw = d.raw as {
          id?: string; // entry.id == WABA business account id
          changes?: {
            value?: {
              event?: string;
              message_template_id?: string;
              message_template_name?: string;
              message_template_language?: string;
              status?: string;
              reason?: string;
            };
          }[];
        };
        const v = raw.changes?.[0]?.value ?? {};
        if (v.event !== "MESSAGE_TEMPLATE_STATUS_UPDATE") return { applied: false };
        await applyTemplateStatusUpdate({
          metaTemplateId: v.message_template_id ?? null,
          wabaBusinessAccountId: raw.id ?? null,
          name: v.message_template_name ?? "",
          status: v.status ?? "unknown",
          rejectionReason: v.reason ?? null,
        });
        return { applied: true };
      });
      await step.run("mark-processed", () =>
        supabaseAdmin()
          .from("webhook_events")
          .update({ status: "processed", processed_at: new Date().toISOString() })
          .eq("channel", "whatsapp")
          .eq("event_type", "template")
          .eq("provider_event_id", d.providerEventId),
      );
      return updated;
    }

    // ---- delivery status updates (sent/delivered/read/failed) ----
    if (d.eventType === "status") {
      for (const st of parsed.statuses) {
        await step.run(`apply-status-${st.providerMessageId}-${st.status}`, async () => {
          const patch = { status: st.status, ...(st.error ? { error: st.error } : {}) };
          await supabaseAdmin()
            .from("messages")
            .update(patch)
            .eq("wa_message_id", st.providerMessageId)
            .in("status", ["queued", "sent", "delivered"]);
        });
      }
      await step.run("mark-processed", () =>
        supabaseAdmin()
          .from("webhook_events")
          .update({ status: "processed", processed_at: new Date().toISOString() })
          .eq("channel", "whatsapp")
          .eq("event_type", "status")
          .eq("provider_event_id", d.providerEventId),
      );
      return { statuses: parsed.statuses.length };
    }

    // ---- inbound messages ----
    if (!parsed.messages.length) {
      await step.run("mark-processed", () =>
        supabaseAdmin()
          .from("webhook_events")
          .update({ status: "processed", processed_at: new Date().toISOString() })
          .eq("channel", "whatsapp")
          .eq("event_type", "message")
          .eq("provider_event_id", d.providerEventId),
      );
      return { skipped: true, reason: "no parseable messages" };
    }

    for (const msg of parsed.messages) {
      const outcome = (await step.run(`process-message-${msg.providerMessageId}`, async () => {
        // Resolve tenant + wa_account by Meta phone number id.
        const { data: waAccount, error: waErr } = await supabaseAdmin()
          .from("wa_accounts")
          .select("id, tenant_id")
          .eq("wa_phone_number_id", msg.channelAccountId)
          .maybeSingle();
        if (waErr || !waAccount) {
          return { ok: false, reason: `no wa_account for phone_number_id=${msg.channelAccountId}` };
        }
        const tenantId = waAccount.tenant_id;

        const text = (msg.content.text ?? "").trim().toUpperCase();
        if (["STOP", "STOPALL", "UNSUBSCRIBE"].includes(text)) {
          await setOptOut(tenantId, msg.senderId, true);
          return { ok: false, reason: "opt_out_acknowledged" };
        }
        if (text === "START") {
          await setOptOut(tenantId, msg.senderId, false);
        }

        const contact = await getOrCreateContact(
          tenantId,
          msg.senderId,
          (msg.content.meta as { profile_name?: string } | undefined)?.profile_name ?? null,
        );

        const agent = await pickAgentForConversation({
          tenantId,
          channel: "whatsapp",
          channelAccountId: waAccount.id,
        });

        const conversation = await getOrCreateConversation({
          tenantId,
          contactId: contact.id,
          channel: "whatsapp",
          channelAccountId: waAccount.id,
          senderId: msg.senderId,
          agentId: agent?.id ?? null,
        });

        await recordInboundMessage({
          conversationId: conversation.id,
          content: { type: "text", text: msg.content.text ?? "", meta: msg.content.meta },
          waMessageId: msg.providerMessageId,
        });

        return {
          ok: true,
          tenantId: waAccount.tenant_id,
          waAccountId: waAccount.id,
          conversationId: conversation.id,
          contactId: contact.id,
        };
      })) as
        | { ok: false; reason: string }
        | { ok: true; tenantId: string; waAccountId: string; conversationId: string; contactId: string };

      if (!outcome.ok) {
        logger.info("message skipped", { reason: outcome.reason });
        continue;
      }

      await step.sendEvent("emit-message-inbound", {
        name: messageInbound.name,
        data: {
          tenantId: outcome.tenantId,
          channel: "whatsapp",
          channelAccountId: outcome.waAccountId,
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
        .eq("channel", "whatsapp")
        .eq("event_type", "message")
        .eq("provider_event_id", d.providerEventId),
    );

    return { processed: parsed.messages.length };
  },
);
