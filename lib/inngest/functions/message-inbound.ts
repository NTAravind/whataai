import { inngest } from "@/lib/clients/ingest";
import { messageInbound } from "@/lib/inngest/events";
import { supabaseAdmin } from "@/lib/clients/supabase";
import { loadConversationContext, listMessages } from "@/lib/services/conversations";
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

    const agent = ctx.conversationContext.agent;
    if (!agent) {
      logger.warn("no agent assigned", { conversationId: d.conversationId });
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
    });

    if (result.text.trim().length === 0) {
      logger.warn("empty agent response", { conversationId: d.conversationId });
      return { skipped: true, reason: "empty_response" };
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
        content: { type: "text", text: result.text },
        agentId: agent.id,
      });
      return message.id;
    });

    await step.run("record-usage", async () => {
      const { error } = await supabaseAdmin().rpc("increment_usage_counter", {
        tenant_id: d.tenantId,
        tokens: result.usage.totalTokens,
        cost: 0,
      });
      if (error) logger.warn("failed to record usage", { error: error.message });
    });

    return { replyMessageId: sent, iterations: result.iterations };
  },
);
