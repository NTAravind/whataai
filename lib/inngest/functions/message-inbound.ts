import { inngest } from "@/lib/clients/ingest";
import { messageInbound } from "@/lib/inngest/events";
import { supabaseAdmin } from "@/lib/clients/supabase";
import { loadConversationContext, listMessages, pickAgentForConversation } from "@/lib/services/conversations";
import { runDurableAgent, historyFromDb } from "@/lib/agents/runtime";
import { resolveEntitlements, hasTokenBudget } from "@/lib/entitlements/resolve";
import { enqueueOutboundMessage } from "@/lib/services/messages";

/**
 * Core orchestration function (docs/guide.md §7 — `message.inbound`).
 *
 * One durable function per inbound message:
 *   1. resolve entitlements → budget check (hard/soft per plan)
 *   2. load conversation context + recent history
 *   3. run the ReAct agent (checkpointed steps inside)
 *   4. persist the assistant reply
 *   5. fan out to the durable outbound send
 *   6. reconcile usage counters (per-run)
 */
export const messageInboundFunction = inngest.createFunction(
  {
    id: "message-inbound",
    name: "Message Inbound Orchestration",
    triggers: [messageInbound],
    idempotency: "event.data.providerMessageId",
    retries: 3,
  },
  async ({ event, step, logger }) => {
    const d = event.data;

    const entitlements = await step.run("resolve-entitlements", () =>
      resolveEntitlements(d.tenantId),
    );

    const budget = await step.run("check-budget", () =>
      hasTokenBudget(d.tenantId, entitlements),
    );

    if (!budget.allowed) {
      logger.warn("token budget exhausted", { tenantId: d.tenantId, used: budget.tokensUsed });
      await step.run("budget-exhausted-notice", async () => {
        await enqueueOutboundMessage({
          tenantId: d.tenantId,
          channel: d.channel,
          channelAccountId: d.channelAccountId,
          conversationId: d.conversationId,
          contactId: d.contactId,
          senderId: d.senderId,
          content: {
            type: "text",
            text: "Thanks for your message — our team is currently unavailable. We'll be back shortly.",
          },
          agentId: null,
        });
      });
      return { budget: "exhausted" };
    }

    const ctx = await step.run("load-context", async () => {
      const conversationContext = await loadConversationContext(d.conversationId);
      const messages = await listMessages(d.conversationId, 50);
      return { conversationContext, history: historyFromDb(messages) };
    });

    let agent = ctx.conversationContext.agent;
    if (!agent) {
      agent = (await step.run("assign-fallback-agent", async () => {
        const fallback = await pickAgentForConversation({
          tenantId: d.tenantId,
          channel: d.channel,
          channelAccountId: d.channelAccountId,
        });
        if (!fallback) return null;

        const { error } = await supabaseAdmin()
          .from("conversations")
          .update({ agent_id: fallback.id })
          .eq("id", d.conversationId)
          .eq("tenant_id", d.tenantId);
        if (error) throw error;
        return fallback;
      })) as typeof agent;
    }

    if (!agent) {
      logger.warn("no agent available", { conversationId: d.conversationId, tenantId: d.tenantId });
      return { skipped: true, reason: "no_agent" };
    }

    const result = await runDurableAgent({
      agent: {
        id: agent.id,
        type: agent.type,
        name: agent.name,
        instructions: agent.instructions,
        model_config: agent.model_config,
        tools: agent.tools,
      },
      ctx: {
        tenantId: d.tenantId,
        conversationId: d.conversationId,
        contactId: d.contactId,
        customerName: ctx.conversationContext.contact.full_name,
      },
      history: ctx.history as Awaited<ReturnType<typeof historyFromDb>>,
      step,
      logger: {
        warn: (message, data) => logger.warn(message, data),
      },
    });

    const replyText = result.text.trim() || "Thanks for your message. Please give us a moment while we look into this.";
    if (!result.text.trim()) {
      logger.warn("empty agent response; sending fallback", {
        conversationId: d.conversationId,
        agentId: agent.id,
        iterations: result.iterations,
        endedWithToolCall: result.endedWithToolCall,
        finalMessageType: result.finalMessageType,
        generatedAssistantMessages: result.generatedAssistantMessages,
      });
    }

    // Persist assistant message + send it durably (separate function so a
    // Meta outage doesn't retry the whole agent run).
    const sent = await step.run("enqueue-outbound", async () => {
      const message = await enqueueOutboundMessage({
        tenantId: d.tenantId,
        channel: d.channel,
        channelAccountId: d.channelAccountId,
        conversationId: d.conversationId,
        contactId: d.contactId,
        senderId: d.senderId,
        content: { type: "text", text: replyText },
        agentId: agent.id,
      });
      return message.id;
    });
    logger.info("outbound agent reply enqueued", {
      conversationId: d.conversationId,
      messageId: sent,
      usedFallback: !result.text.trim(),
    });

    await step.run("record-usage", async () => {
      const usage = result.usage;
      const promptTokens = usage.inputTokens ?? 0;
      const completionTokens = usage.outputTokens ?? 0;
      const totalTokens = usage.totalTokens ?? (promptTokens + completionTokens);
      const cost = result.cost ?? 0;

      if (totalTokens > 0) {
        const { error: counterErr } = await supabaseAdmin().rpc("increment_usage_counter", {
          tenant_id: d.tenantId,
          tokens: totalTokens,
          cost,
        });
        if (counterErr) logger.warn("failed to increment usage counter", { error: counterErr.message });

        const { error: eventErr } = await supabaseAdmin().from("usage_events").insert({
          tenant_id: d.tenantId,
          message_id: sent,
          agent_id: agent.id,
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_tokens: totalTokens,
          cost_usd: cost,
          model: agent.model_config?.model ?? null,
        });
        if (eventErr) logger.warn("failed to insert usage event", { error: eventErr.message });
      }
    });

    return { replyMessageId: sent, iterations: result.iterations };
  },
);
