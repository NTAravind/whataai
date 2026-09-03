import { StateGraph, START, END } from "@langchain/langgraph";
import { AgentState } from "./state";
import { createAgentNode, createToolNode, buildSystemPrompt } from "./nodes";
import { buildLangChainTools } from "./tools";
import { nextAfterTools, shouldContinue } from "./edges";
import type { AgentToolCtx } from "@/lib/agents/registry";
import { DEFAULT_MODEL } from "../provider";

export interface BuildGraphInput {
  agent: {
    instructions: string;
    model_config: Record<string, unknown>;
    tools: string[];
  };
  ctx: AgentToolCtx;
}

export async function buildAgentGraph(input: BuildGraphInput) {
  const modelName =
    (input.agent.model_config?.model as string | undefined) ??
    process.env.AI_MODEL ??
    DEFAULT_MODEL;

  const lcTools = buildLangChainTools(input.agent.tools, input.ctx);
  const systemPrompt = await buildSystemPrompt(
    input.agent.instructions,
    input.ctx.tenantId,
    input.agent.tools,
  );

  const agentNode = createAgentNode(modelName, systemPrompt, lcTools);
  const toolNode = createToolNode(lcTools);
  const finalAgentNode = createAgentNode(
    modelName,
    `${systemPrompt}\n\nYou have completed the available tool actions. Give the customer a concise final response based on the conversation and tool results. Do not call any tools.`,
    [],
  );

  const graph = new StateGraph(AgentState)
    .addNode("agent", agentNode)
    .addNode("tools", toolNode)
    .addNode("final", finalAgentNode)
    .addEdge(START, "agent")
    .addConditionalEdges("agent", shouldContinue, {
      [END]: END,
      tools: "tools",
    })
    .addConditionalEdges("tools", nextAfterTools, {
      agent: "agent",
      final: "final",
    })
    .addEdge("final", END);

  return graph.compile();
}
