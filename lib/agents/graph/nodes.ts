import { AIMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { AgentState } from "./state";
import { buildLangChainTools } from "./tools";
import { getBusinessContextPrompt } from "@/lib/services/businesses";
import { requiresApproval, storePendingAction } from "./hitl";
import { getLangChainModel } from "../provider";

function buildDateTimeBlock(timezone: string): string {
  const now = new Date();
  const nowFormatted = new Intl.DateTimeFormat("en-US", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: timezone,
  }).format(now);

  return `
## Current date & time
Right now it is: ${nowFormatted} (${timezone})

Rules for handling dates and times:
- This timestamp is ground truth. Never guess, assume, or recall the date from your own training.
- Resolve every relative date/time reference against this exact timestamp.
- If a user's requested date/time is ambiguous, ask for clarification.
- Always pass fully resolved ISO 8601 date/time values — never relative phrases.
- If the resolved date falls in the past, flag it back to the user.
- Do not state the current date/time to the user unless they ask.
`.trim();
}

export async function buildSystemPrompt(
  agentInstructions: string,
  tenantId: string,
  enabledTools: string[],
): Promise<string> {
  const bizContext = await getBusinessContextPrompt(tenantId);
  let systemPrompt = `${agentInstructions ?? ""}${bizContext.prompt}`;
  systemPrompt += `\n\n${buildDateTimeBlock(bizContext.timezone)}`;

  if (
    enabledTools.includes("check_availability") ||
    enabledTools.includes("create_booking")
  ) {
    systemPrompt += `

## Additional Booking Instructions:
- Ask the customer for their preferred date, time, and specific staff member / doctor / room / resource (if applicable).
- ALWAYS call \`check_availability\` for the date and resource before offering times or confirming a booking.
- When calling \`create_booking\`, specify the date, time, customer name, and the specific resource/staff member agreed upon.
- After \`create_booking\` succeeds, IMMEDIATELY call \`schedule_reminder\` with the booking ID returned in the result. Do not ask the customer — just do it. Use 24 hours as the default lead time.`;
  }

  return systemPrompt;
}

export function createAgentNode(
  modelName: string,
  systemPrompt: string,
  lcTools: ReturnType<typeof buildLangChainTools>,
) {
  const model = getLangChainModel(modelName, 0.7);
  const llm = lcTools.length > 0 ? model.bindTools(lcTools) : model;

  return async (state: typeof AgentState.State) => {
    const messages = [
      new SystemMessage(systemPrompt),
      ...state.messages,
    ];

    const response = await llm.invoke(messages);

    return {
      messages: [response],
      iteration: state.iteration + 1,
    };
  };
}

export function createToolNode(
  lcTools: ReturnType<typeof buildLangChainTools>,
) {
  return new ToolNode(lcTools);
}

export function createHitlToolNode(
  lcTools: ReturnType<typeof buildLangChainTools>,
  agentId: string,
) {
  return async (state: typeof AgentState.State) => {
    const lastMessage = state.messages[state.messages.length - 1];
    if (!(lastMessage instanceof AIMessage) || !lastMessage.tool_calls?.length) {
      return {};
    }

    const results: ToolMessage[] = [];

    for (const tc of lastMessage.tool_calls) {
      const needsApproval = await requiresApproval(agentId, tc.name);

      if (needsApproval) {
        await storePendingAction({
          threadId: state.metadata.conversationId,
          ctx: {
            tenantId: state.metadata.tenantId,
            conversationId: state.metadata.conversationId,
            contactId: state.metadata.contactId,
            customerName: state.metadata.customerName,
          },
          toolName: tc.name,
          toolArgs: tc.args as Record<string, unknown>,
        });

        results.push(
          new ToolMessage({
            content: `[PENDING APPROVAL] The "${tc.name}" action has been submitted for human review. Tell the customer their request is being reviewed and will be processed shortly.`,
            tool_call_id: tc.id ?? "",
          }),
        );
      } else {
        const lcTool = lcTools.find((t) => t.name === tc.name);
        if (lcTool) {
          try {
            const output = await (lcTool as { invoke(args: unknown): Promise<unknown> }).invoke(tc.args);
            results.push(
              new ToolMessage({ content: String(output), tool_call_id: tc.id ?? "" }),
            );
          } catch (err) {
            const detail = err instanceof Error ? err.message : String(err);
            results.push(
              new ToolMessage({
                content: `The "${tc.name}" tool failed: ${detail}. Do not invent details — let the customer know the action couldn't be completed.`,
                tool_call_id: tc.id ?? "",
              }),
            );
          }
        }
      }
    }

    return { messages: results };
  };
}
