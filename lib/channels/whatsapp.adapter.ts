import type {
  ChannelAdapter,
  ChannelCtx,
  InboundMessage,
  SendResult,
  TemplateRef,
  FlowRef,
} from "./channel.interface";
import {
  sendTextMessage,
  sendTemplateMessage,
  triggerFlow as metaTriggerFlow,
} from "@/lib/meta/whatsapp";

/**
 * WhatsApp Cloud API adapter.
 *
 * Per docs/guide.md §13: the adapter decides message *tier* (free
 * customer-service text inside the 24h window vs paid template outside it),
 * so callers don't have to know WhatsApp pricing rules.
 */
export const whatsappAdapter: ChannelAdapter = {
  channel: "whatsapp",

  async sendText(ctx, to, text): Promise<SendResult> {
    try {
      const phoneNumberId = await resolvePhoneNumberId(ctx);
      const { messages } = await sendTextMessage({ phoneNumberId, to, text });
      return { providerMessageId: messages[0]?.id, status: "queued" };
    } catch (err) {
      return { status: "failed", error: err instanceof Error ? err.message : String(err) };
    }
  },

  async sendTemplate(ctx, to, template: TemplateRef): Promise<SendResult> {
    try {
      const phoneNumberId = await resolvePhoneNumberId(ctx);
      const { messages } = await sendTemplateMessage({
        phoneNumberId,
        to,
        templateName: template.name,
        language: template.language,
        components: template.components,
      });
      return { providerMessageId: messages[0]?.id, status: "queued" };
    } catch (err) {
      return { status: "failed", error: err instanceof Error ? err.message : String(err) };
    }
  },

  async triggerFlow(ctx, to, flow: FlowRef): Promise<SendResult> {
    try {
      const phoneNumberId = await resolvePhoneNumberId(ctx);
      const { messages } = await metaTriggerFlow({
        phoneNumberId,
        to,
        flowId: flow.flowId,
        ctaText: flow.ctaText,
        data: flow.data,
      });
      return { providerMessageId: messages[0]?.id, status: "queued" };
    } catch (err) {
      return { status: "failed", error: err instanceof Error ? err.message : String(err) };
    }
  },

  parseWebhook(raw: unknown) {
    const messages: InboundMessage[] = [];
    const statuses: NonNullable<ReturnType<ChannelAdapter["parseWebhook"]>["statuses"]> = [];

    const body = raw as {
      entry?: {
        id?: string;
        changes?: {
          value?: {
            messaging_product?: string;
            metadata?: { phone_number_id?: string; display_phone_number?: string };
            contacts?: { wa_id?: string; profile?: { name?: string } }[];
            messages?: {
              from?: string;
              id?: string;
              timestamp?: string;
              type?: string;
              text?: { body?: string };
              interactive?: { type?: string; button_reply?: { id?: string; title?: string } };
            }[];
            statuses?: {
              id?: string;
              status?: string;
              timestamp?: string;
              errors?: { code?: number; title?: string; message?: string }[];
            }[];
          };
        }[];
      }[];
    };

    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value;
        if (!value) continue;

        for (const msg of value.messages ?? []) {
          if (!msg.id || !msg.from) continue;
          let text: string | undefined;
          if (msg.type === "text") text = msg.text?.body;
          else if (msg.type === "interactive") text = msg.interactive?.button_reply?.title;

          messages.push({
            channel: "whatsapp",
            providerMessageId: msg.id,
            senderId: msg.from,
            channelAccountId: value.metadata?.phone_number_id ?? "",
            content: {
              type: "text",
              text: text ?? "",
              meta: { profile_name: value.contacts?.[0]?.profile?.name },
            },
            receivedAt: new Date((msg.timestamp ? Number(msg.timestamp) : Date.now()) * 1000).toISOString(),
          });
        }

        for (const st of value.statuses ?? []) {
          if (!st.id || !st.status) continue;
          const error = st.errors?.[0]
            ? { code: st.errors[0].code, title: st.errors[0].title, message: st.errors[0].message }
            : undefined;
          statuses.push({
            providerMessageId: st.id,
            status: st.status as "sent" | "delivered" | "read" | "failed",
            ...(error ? { error } : {}),
          });
        }
      }
    }

    return { messages, statuses };
  },
};

async function resolvePhoneNumberId(ctx: ChannelCtx): Promise<string> {
  // ctx.channelAccountId is wa_accounts.id (a uuid), not the Meta phone
  // number id. Look it up via the admin client.
  const { supabaseAdmin } = await import("@/lib/clients/supabase");
  const { data, error } = await supabaseAdmin()
    .from("wa_accounts")
    .select("wa_phone_number_id")
    .eq("id", ctx.channelAccountId)
    .single();

  if (error || !data) {
    throw new Error(`wa_account ${ctx.channelAccountId} not found or has no phone number id`);
  }
  return data.wa_phone_number_id;
}
