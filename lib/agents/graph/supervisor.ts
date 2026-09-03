import { StateGraph, START, END, Annotation } from "@langchain/langgraph";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { AgentState } from "./state";
import { createAgentNode, createToolNode, buildSystemPrompt } from "./nodes";
import { buildLangChainTools } from "./tools";
import { nextAfterTools, shouldContinue } from "./edges";
import type { AgentToolCtx } from "@/lib/agents/registry";
import { DEFAULT_MODEL, getLangChainModel } from "../provider";

const SupervisorState = Annotation.Root({
  ...AgentState.spec,
  next: Annotation<string>({
    reducer: (_, update) => update,
    default: () => "",
  }),
});

const ROUTE_MAP: Record<string, { tools: string[]; prompt: string; model?: string }> = {
  faq: {
    tools: ["search_knowledge_base", "get_current_datetime", "escalate_to_human"],
    prompt: `You are a FAQ specialist. Answer customer questions using the knowledge base.
Search the KB first. If you can't find the answer, escalate to a human.
Never invent business facts.`,
    model: DEFAULT_MODEL,
  },
  booking: {
    tools: ["check_availability", "create_booking", "cancel_booking", "list_resources", "schedule_reminder", "get_current_datetime", "escalate_to_human"],
    prompt: `You are a booking specialist. Help customers book, reschedule, or cancel appointments.
Always check availability before suggesting times. After creating a booking, schedule a reminder.`,
    model: DEFAULT_MODEL,
  },
  template: {
    tools: ["list_templates", "send_template", "list_flows", "trigger_flow", "escalate_to_human"],
    prompt: `You are a WhatsApp template specialist. Help customers interact with templates and flows.
Use list_templates to see what's available before sending.`,
    model: DEFAULT_MODEL,
  },
  escalation: {
    tools: ["escalate_to_human"],
    prompt: `You are an escalation specialist. The customer needs to talk to a human.
Use escalate_to_human immediately with a clear reason.`,
    model: DEFAULT_MODEL,
  },
};

function createSupervisorNode(modelName: string) {
  const llm = getLangChainModel(modelName, 0);

  return async (state: typeof SupervisorState.State) => {
    const lastMessage = state.messages[state.messages.length - 1];
    const userText = typeof lastMessage.content === "string"
      ? lastMessage.content
      : JSON.stringify(lastMessage.content);

    const response = await llm.invoke([
      new SystemMessage(`Classify the customer message into exactly one category:
- faq: general questions (hours, pricing, policies, services)
- booking: booking, appointment, schedule, reschedule, cancel
- template: WhatsApp template, send message, flow, form
- escalation: wants a human, complaint, urgent, frustrated

Respond with ONLY the category name.`),
      new HumanMessage(userText),
    ]);

    const category = (response.content as string).trim().toLowerCase();
    const valid = Object.keys(ROUTE_MAP);
    const next = valid.includes(category) ? category : "faq";

    return { next };
  };
}

export async function buildSupervisorGraph(input: {
  agentId: string;
  instructions: string;
  model_config: Record<string, unknown>;
  enabledTools: string[];
  ctx: AgentToolCtx;
}) {
  const supervisorNode = createSupervisorNode(DEFAULT_MODEL);

  const subAgentNodes: Record<string, ReturnType<typeof createAgentNode>> = {};
  const subAgentToolNodes: Record<string, ReturnType<typeof createToolNode>> = {};
  const finalAgentNodes: Record<string, ReturnType<typeof createAgentNode>> = {};

  for (const [category, config] of Object.entries(ROUTE_MAP)) {
    const agentTools = config.tools.filter((t) => input.enabledTools.includes(t));
    const lcTools = buildLangChainTools(agentTools, input.ctx);
    const systemPrompt = await buildSystemPrompt(
      `${input.instructions}\n\n${config.prompt}`,
      input.ctx.tenantId,
      agentTools,
    );

    subAgentNodes[category] = createAgentNode(
      config.model ?? DEFAULT_MODEL,
      systemPrompt,
      lcTools,
    );
    subAgentToolNodes[category] = createToolNode(lcTools);
    finalAgentNodes[category] = createAgentNode(
      config.model ?? DEFAULT_MODEL,
      `${systemPrompt}\n\nYou have completed the available tool actions. Give the customer a concise final response based on the conversation and tool results. Do not call any tools.`,
      [],
    );
  }

  const graph = new StateGraph(SupervisorState)
    .addNode("supervisor", supervisorNode);

  for (const [category, nodeFn] of Object.entries(subAgentNodes)) {
    graph.addNode(category, nodeFn);
    graph.addNode(`${category}-tools`, subAgentToolNodes[category]);
    graph.addNode(`${category}-final`, finalAgentNodes[category]);
  }

  graph.addConditionalEdges("supervisor", (state) => state.next, {
    ...Object.fromEntries(Object.keys(subAgentNodes).map((k) => [k, k])),
  } as never);

  for (const category of Object.keys(subAgentNodes)) {
    graph.addConditionalEdges(category as never, shouldContinue, {
      [END]: END,
      tools: `${category}-tools`,
    } as never);
    graph.addConditionalEdges(`${category}-tools` as never, nextAfterTools, {
      agent: category,
      final: `${category}-final`,
    } as never);
    graph.addEdge(`${category}-final` as never, END);
  }

  graph.addEdge(START, "supervisor");

  return graph.compile();
}
