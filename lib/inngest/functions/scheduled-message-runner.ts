import { inngest } from "@/lib/clients/ingest";
import { scheduleMessageRun, messageOutboundSend } from "@/lib/inngest/events";
import { supabaseAdmin } from "@/lib/clients/supabase";
import { getScheduledMessage } from "@/lib/services/scheduling";

/**
 * Scheduled message runner (docs/api-guide.md — Meta /schedules mirror,
 * except timing lives in Inngest rather than Meta).
 *
 * Fired by `schedule/message.run` whose `ts` field is the send time, so the
 * event only exists when the message is actually due. The runner marks the
 * scheduled_messages row and re-emits the durable outbound send.
 */
export const scheduledMessageRunner = inngest.createFunction(
  {
    id: "scheduled-message-runner",
    name: "Scheduled Message Runner",
    triggers: [scheduleMessageRun],
    idempotency: "event.data.scheduledMessageId",
    retries: 3,
  },
  async ({ event, step }) => {
    const { scheduledMessageId } = event.data;

    const scheduled = await step.run("load-scheduled", async () => {
      const row = (await getScheduledMessage(scheduledMessageId)) as unknown as {
        status: string;
        tenant_id: string;
        channel: "whatsapp" | "mail";
        wa_account_id: string | null;
        mail_account_id: string | null;
        contact_id: string;
        conversation_id: string | null;
        content: Record<string, unknown>;
        template_id: string | null;
      };
      const { data: contact } = await supabaseAdmin()
        .from("contacts")
        .select("phone_number, email")
        .eq("id", row.contact_id)
        .single();
      const address = row.channel === "whatsapp" ? contact?.phone_number : contact?.email;
      return { ...row, address };
    });
    if (scheduled.status === "cancelled") {
      return { skipped: true, reason: "cancelled" };
    }
    if (scheduled.status !== "scheduled" || !scheduled.address) {
      return { skipped: true, reason: `status=${scheduled.status} or no address` };
    }

    const channelAccountId =
      scheduled.channel === "whatsapp" ? scheduled.wa_account_id : scheduled.mail_account_id;

    const sent = await step.run("enqueue-outbound", async () => {
      const { data, error } = await supabaseAdmin()
        .from("messages")
        .insert({
          conversation_id: scheduled.conversation_id ?? null,
          role: "assistant",
          content: scheduled.content as unknown as Record<string, unknown>,
          status: "queued",
        })
        .select()
        .single();
      if (error) throw error;
      return data.id;
    });

    await step.sendEvent("emit-outbound", {
      name: messageOutboundSend.name,
      data: {
        tenantId: scheduled.tenant_id,
        channel: scheduled.channel,
        channelAccountId,
        conversationId: scheduled.conversation_id,
        contactId: scheduled.contact_id,
        senderId: scheduled.address,
        content: scheduled.content as { type: "text" | "template"; text?: string; meta?: Record<string, unknown> },
        templateId: scheduled.template_id ?? undefined,
        messageId: sent,
        scheduledMessageId,
      },
    });

    await step.run("mark-sent", async () => {
      await supabaseAdmin().from("scheduled_messages").update({ status: "sent" }).eq("id", scheduledMessageId);
    });

    return { messageId: sent };
  },
);
