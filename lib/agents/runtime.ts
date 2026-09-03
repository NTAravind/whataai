import { HumanMessage, AIMessage } from "@langchain/core/messages";
import { buildAgentGraph } from "./graph/graph";
import { buildSupervisorGraph } from "./graph/supervisor";
import { calculateCost } from "./pricing";
import { DEFAULT_MODEL } from "./provider";
import type { ModelMessage } from "ai";
import type { AgentToolCtx } from "./registry";

export interface DurableStep {
  run<T>(id: string, fn: () => Promise<T> | T): Promise<unknown>;
}

export interface AgentRunInput {
  agent: {
    id: string;
    type: string;
    name: string;
    instructions: string;
    model_config: Record<string, unknown>;
    tools: string[];
  };
  ctx: AgentToolCtx;
  history: ModelMessage[];
  step: DurableStep;
  logger?: { warn: (message: string, data?: Record<string, unknown>) => void };
  maxIterations?: number;
}

export interface AgentRunResult {
  text: string;
  iterations: number;
  endedWithToolCall: boolean;
  finalMessageType: string;
  generatedAssistantMessages: number;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
  cost: number;
}

type GraphMessage = {
  content?: unknown;
  tool_calls?: unknown[];
  type?: string;
  /** The last segment of this array is the class name, e.g. "AIMessage" */
  id?: string[];
  _getType?: () => string;
  usage_metadata?: { input_tokens?: number; inputTokens?: number; output_tokens?: number; outputTokens?: number };
  response_metadata?: {
    usage?: { input_tokens?: number; inputTokens?: number; output_tokens?: number; outputTokens?: number };
  };
  // Inngest checkpoints class instances as LangChain serialized constructors.
  // After crossing a `step.run()` boundary the LangChain message is plain JSON:
  //   { lc: 1, type: "constructor", id: ["langchain_core","messages","AIMessage"], kwargs: { … } }
  // `type` here is the LangChain serialization marker, NOT the message role.
  // The real role lives in `id[id.length - 1]` (e.g. "AIMessage" → "ai").
  kwargs?: {
    type?: string;
    content?: unknown;
    tool_calls?: unknown[];
    usage_metadata?: { input_tokens?: number; inputTokens?: number; output_tokens?: number; outputTokens?: number };
    response_metadata?: {
      usage?: { input_tokens?: number; inputTokens?: number; output_tokens?: number; outputTokens?: number };
    };
  };
};

/**
 * Resolve the LangChain message role ("ai", "human", "tool", …) regardless of
 * whether the message is a live class instance or a plain-JSON checkpoint that
 * crossed an Inngest `step.run()` boundary.
 *
 * Live instances  → `_getType()` / `kwargs.type` / `message.type`
 * Serialized JSON → `id` array last segment, e.g. "AIMessage" → "ai"
 */
function graphMessageType(message: GraphMessage): string {
  // Live class instance
  const live = message._getType?.() ?? message.kwargs?.type;
  if (live) return live;

  // LangChain JSON serialization: { type: "constructor", id: ["…", "AIMessage"] }
  // `type === "constructor"` is the serialization marker — not the role.
  // Map the class name to the canonical role string.
  if (message.id?.length) {
    const className = message.id[message.id.length - 1];
    const classToRole: Record<string, string> = {
      AIMessage: "ai",
      HumanMessage: "human",
      SystemMessage: "system",
      ToolMessage: "tool",
      FunctionMessage: "function",
      ChatMessage: "chat",
    };
    if (className in classToRole) return classToRole[className];
    // Fallback: strip "Message" suffix and lowercase
    return className.replace(/Message$/i, "").toLowerCase();
  }

  // Plain object with a type field that is not the serialization marker
  if (message.type && message.type !== "constructor") return message.type;

  return "unknown";
}

function graphMessageContent(message: GraphMessage): unknown {
  return message.content ?? message.kwargs?.content;
}

function graphMessageUsage(message: GraphMessage) {
  return message.usage_metadata ?? message.response_metadata?.usage
    ?? message.kwargs?.usage_metadata ?? message.kwargs?.response_metadata?.usage;
}

function toLangChainMessages(history: ModelMessage[]) {
  return history.map((m) => {
    if (m.role === "user") {
      return new HumanMessage(typeof m.content === "string" ? m.content : JSON.stringify(m.content));
    }
    return new AIMessage(typeof m.content === "string" ? m.content : JSON.stringify(m.content));
  });
}

export async function runDurableAgent(input: AgentRunInput): Promise<AgentRunResult> {
  const modelName =
    (input.agent.model_config?.model as string | undefined) ??
    process.env.AI_MODEL ??
    DEFAULT_MODEL;

  // Webhook ingestion persists the inbound message before this function runs.
  // Passing history as-is ensures the newest user message reaches the model
  // exactly once.
  const inputMessages = toLangChainMessages(input.history);

  const raw = (await input.step.run("run-agent-graph", async () => {
    const graph = input.agent.type === "supervisor"
      ? await buildSupervisorGraph({
          agentId: input.agent.id,
          instructions: input.agent.instructions,
          model_config: input.agent.model_config,
          enabledTools: input.agent.tools,
          ctx: input.ctx,
        })
      : await buildAgentGraph({
          agent: {
            instructions: input.agent.instructions,
            model_config: input.agent.model_config,
            tools: input.agent.tools,
          },
          ctx: input.ctx,
        });

    const result = await graph.invoke(
      {
        messages: inputMessages,
        iteration: 0,
        metadata: {
          tenantId: input.ctx.tenantId,
          conversationId: input.ctx.conversationId ?? "",
          contactId: input.ctx.contactId ?? "",
          customerName: input.ctx.customerName ?? undefined,
          agentId: input.agent.id,
          modelName,
        },
      },
      { configurable: { thread_id: input.ctx.conversationId } },
    );

    return result;
  })) as { messages: GraphMessage[]; iteration: number };

  function extractText(content: unknown): string {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      const textParts = content
        .flatMap((block) => extractText(block));
      return textParts.join("");
    }
    if (content && typeof content === "object") {
      const block = content as { type?: unknown; text?: unknown; content?: unknown };
      if (typeof block.text === "string") return block.text;
      if (block.content !== undefined) return extractText(block.content);
    }
    return "";
  }

  const iterations = raw.iteration ?? 1;

  const inputMessageCount = inputMessages.length;
  const generatedThisTurn = raw.messages.slice(inputMessageCount);
  const assistantMessages = generatedThisTurn.filter((message) => graphMessageType(message) === "ai");
  const text = assistantMessages
    .map((message) => extractText(graphMessageContent(message)).trim())
    .findLast((message) => message.length > 0) ?? "";
  const lastMessage = raw.messages[raw.messages.length - 1];

  let inputTokens = 0;
  let outputTokens = 0;
  for (const m of generatedThisTurn) {
    const usage = graphMessageUsage(m);
    if (usage) {
      inputTokens += usage.input_tokens ?? usage.inputTokens ?? 0;
      outputTokens += usage.output_tokens ?? usage.outputTokens ?? 0;
    }
  }

  const usage = { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens };
  const cost = calculateCost(modelName, usage.inputTokens, usage.outputTokens);

  return {
    text,
    iterations,
    endedWithToolCall: Boolean(lastMessage?.tool_calls?.length ?? lastMessage?.kwargs?.tool_calls?.length),
    finalMessageType: lastMessage ? graphMessageType(lastMessage) : "unknown",
    generatedAssistantMessages: assistantMessages.length,
    usage,
    cost,
  };
}

export function historyFromDb(rows: { role: string; content: unknown }[]): ModelMessage[] {
  const out: ModelMessage[] = [];
  for (const row of rows) {
    const content = (row.content ?? {}) as { type?: string; text?: string; meta?: Record<string, unknown> };
    if (row.role === "user") {
      out.push({ role: "user", content: content.text ?? "" });
    } else if (row.role === "assistant") {
      out.push({ role: "assistant", content: content.text ?? "" });
    }
  }
  return out.slice(-24);
}
