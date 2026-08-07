import { inngest } from "@/lib/clients/ingest";
import { messageOutboundSend } from "@/lib/inngest/events";
import { getAdapter } from "@/lib/channels/registry";
import { supabaseAdmin } from "@/lib/clients/supabase";
import { updateMessageStatus } from "@/lib/services/messages";
import { getTemplate } from "@/lib/services/templates";

/**
 * Durable outbound sender (docs/guide.md §7 — `message.outbound` family).
 *
 * Called by the dashboard, server actions, and the agent orchestration
 * function. Loads the tenant's last inbound timestamp, picks a template when
 * the 24h WhatsApp window has lapsed, and keeps the `messages` row's status
 * in sync (queued → sent → delivered/read via the status webhook).
 */
export const outboundMessage = inngest.createFunction(
  {
    id: "outbound-message",
    name: "Outbound Message Send",
    triggers: [messageOutboundSend],
    idempotency: "event.data.messageId ?? event.data.scheduledMessageId",
    retries: 4,
  },
  async ({ event, step, logger }) => {
    const d = event.data;
    const adapter = getAdapter(d.channel);

    // Resolve last inbound time (drives WA free-tier vs template decision).
    const ctx = await step.run("load-channel-context", async () => {
      const { data: conv } = await supabaseAdmin()
        .from("conversations")
        .select("last_inbound_at")
        .eq("id", d.conversationId ?? "")
        .maybeSingle();
      return {
        tenantId: d.tenantId,
        channelAccountId: d.channelAccountId,
        lastInboundAt: conv?.last_inbound_at ?? null,
      };
    });

    let result: { providerMessageId?: string; status: "queued" | "sent" | "failed"; error?: string };

    if (d.content.type === "text" && adapter.sendText) {
      result = await step.run("send-text", () => adapter.sendText!(ctx, d.senderId, d.content.text ?? ""));
    } else if (d.content.type === "template" && adapter.sendTemplate) {
      const template = await step.run("load-template", async () => {
        if (d.templateId) {
          const t = await getTemplate(d.templateId, d.tenantId);
          return t;
        }
        await supabaseAdmin()
          .from("conversations")
          .select("contact_id")
          .eq("id", d.conversationId ?? "")
          .maybeSingle();
        const { data: waAccount } = await supabaseAdmin()
          .from("wa_accounts")
          .select("id")
          .eq("id", d.channelAccountId)
          .maybeSingle();
        const { data: tpl, error } = await supabaseAdmin()
          .from("whatsapp_templates")
          .select("*")
          .eq("tenant_id", d.tenantId)
          .eq("wa_account_id", waAccount?.id ?? "")
          .eq("status", "approved")
          .limit(1)
          .maybeSingle();
        if (error) throw error;
        return tpl;
      });

      const templateMeta = (d.content.meta ?? {}) as { parameters?: unknown[] };
      const bodyParameters =
        Array.isArray(templateMeta.parameters) && templateMeta.parameters.length
          ? [{ type: "body", parameters: templateMeta.parameters.map((v) => ({ type: "text", text: String(v) })) }]
          : undefined;

      result = await step.run("send-template", () =>
        adapter.sendTemplate!(ctx, d.senderId, {
          name: template.name,
          language: template.language,
          components: bodyParameters ?? template.components ?? undefined,
        }),
      );
    } else if (d.content.type === "flow" && adapter.triggerFlow) {
      result = await step.run("send-flow", () =>
        adapter.triggerFlow!(ctx, d.senderId, {
          flowId: String(d.content.meta?.flowId ?? ""),
          ctaText: String(d.content.meta?.ctaText ?? "Start"),
          data: (d.content.meta?.data as Record<string, unknown>) ?? {},
        }),
      );
    } else {
      logger.warn("no send path for content type", { type: d.content.type, channel: d.channel });
      return { skipped: true, reason: "unsupported content type" };
    }

    if (d.messageId && result.providerMessageId) {
      await step.run("persist-sent", () =>
        updateMessageStatus(d.messageId!, {
          status: result.status,
          error: result.status === "failed" ? { detail: result.error } : undefined,
        }),
      );
    }

    if (result.status === "failed") {
      await step.run("persist-failed", async () => {
        if (d.messageId) {
          await updateMessageStatus(d.messageId, { status: "failed", error: { detail: result.error } });
        }
      });
      throw new Error(`send failed: ${result.error}`);
    }

    return { providerMessageId: result.providerMessageId, status: result.status };
  },
);
