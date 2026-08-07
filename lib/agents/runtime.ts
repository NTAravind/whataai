import { generateText, type ModelMessage, type ToolContent } from "ai";
import { google } from "@ai-sdk/google";
import { buildAgentTools, type AgentToolCtx } from "./registry";

/**
 * Minimal structural type for the subset of Inngest's `step` we use, so this
 * module stays testable outside Inngest.
 */
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
  maxIterations?: number;
}

export interface AgentRunResult {
  text: string;
  iterations: number;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
}

const DEFAULT_MODEL = "gemini-3.1-flash-lite";

/**
 * Durable ReAct agent loop (docs/llms/inngest.txt — "Build an Agent Tool
 * Loop"). Every LLM call and every tool execution is a checkpointed
 * `step.run()`; if the process dies mid-loop, Inngest replays memoized steps
 * and continues exactly where it left off.
 */
export async function runDurableAgent(input: AgentRunInput): Promise<AgentRunResult> {
  const maxIterations = input.maxIterations ?? 6;
  const modelName =
    (input.agent.model_config?.model as string | undefined) ??
    process.env.AI_MODEL ??
    DEFAULT_MODEL;

  const model = google(modelName);
  const tools = buildAgentTools(input.agent.tools, input.ctx);

  const messages: ModelMessage[] = [...input.history];
  const usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  let iterations = 0;

  while (iterations < maxIterations) {
    iterations++;

    const think = (await input.step.run(`agent-think-${iterations}`, async () =>
      generateText({
        model,
        system: input.agent.instructions,
        messages,
        tools,
        temperature: 0.7,
      }),
    )) as Awaited<ReturnType<typeof generateText>>;

    usage.inputTokens += think.usage.inputTokens ?? 0;
    usage.outputTokens += think.usage.outputTokens ?? 0;
    usage.totalTokens += think.usage.totalTokens ?? 0;

    const toolCalls = think.toolCalls;
    if (!toolCalls.length) {
      return { text: think.text, iterations, usage };
    }

    messages.push({
      role: "assistant",
      content: [
        ...(think.text ? [{ type: "text" as const, text: think.text }] : []),
        ...toolCalls.map((tc) => ({
          type: "tool-call" as const,
          toolCallId: tc.toolCallId,
          toolName: tc.toolName,
          input: tc.input,
        })),
      ],
    });

    const toolResults: ToolContent = [];
    for (let i = 0; i < toolCalls.length; i++) {
      const tc = toolCalls[i];
      const execute = tools[tc.toolName]?.execute as
        | ((input: unknown) => Promise<string>)
        | undefined;
      const result = (await input.step.run(`agent-tool-${iterations}-${tc.toolName}-${i}`, async () => {
        if (!execute) return `Unknown tool: ${tc.toolName}`;
        try {
          return await execute(tc.input);
        } catch (err) {
          return `Tool error: ${err instanceof Error ? err.message : String(err)}`;
        }
      })) as string;
      toolResults.push({
        type: "tool-result" as const,
        toolCallId: tc.toolCallId,
        toolName: tc.toolName,
        output: { type: "text" as const, value: result },
      });
    }
    messages.push({ role: "tool", content: toolResults });
  }

  return {
    text: "I was unable to resolve this within my limits. A human agent will follow up shortly.",
    iterations,
    usage,
  };
}

/** Convert DB `messages.content` rows into AI SDK model messages. */
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
