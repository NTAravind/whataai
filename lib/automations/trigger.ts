import { inngest } from "@/lib/clients/ingest";
import { automationTriggered } from "@/lib/inngest/events";
import { listActiveAutomationsForTrigger } from "@/lib/services/automations";
import type { AutomationRow } from "@/lib/services/automations";

/**
 * Emit `automation/triggered` for automations matching a trigger. One event
 * per active automation; the durable function (automation-run) owns the run.
 */

export interface TriggerEmissionInput {
  tenantId: string;
  agentId?: string | null;
  conversationId?: string | null;
  contactId?: string | null;
  /** The tool that just executed (on_tool_call matching). */
  toolName?: string;
}

async function emit(
  automations: AutomationRow[],
  input: TriggerEmissionInput,
): Promise<{ emitted: number }> {
  if (automations.length === 0) return { emitted: 0 };
  await inngest.send(
    automations.map((a) => ({
      name: automationTriggered.name,
      data: {
        automationId: a.id,
        tenantId: input.tenantId,
        conversationId: input.conversationId ?? undefined,
        contactId: input.contactId ?? undefined,
        variables: {},
      },
    })),
  );
  return { emitted: automations.length };
}

/** After the agent replies — scope: the agent that answered, or all agents. */
export async function emitAfterAgentReply(input: TriggerEmissionInput) {
  const automations = await listActiveAutomationsForTrigger(
    input.tenantId,
    "after_agent_reply",
    input.agentId ?? null,
  );
  return emit(automations, input);
}

/** After a tool executes — match active `on_tool_call` automations by tool_name. */
export async function emitOnToolCall(input: TriggerEmissionInput) {
  if (!input.toolName) return { emitted: 0 };
  const automations = (
    await listActiveAutomationsForTrigger(input.tenantId, "on_tool_call", input.agentId ?? null)
  ).filter((a) => {
    const conf = a.trigger_config as { tool_name?: string };
    return conf.tool_name === input.toolName;
  });
  return emit(automations, input);
}