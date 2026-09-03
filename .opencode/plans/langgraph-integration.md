# LangGraph Integration Plan

**Date:** 2026-08-24
**Status:** Draft
**Goal:** Integrate LangGraph into WhataAI as the agent state machine, while keeping Vercel AI SDK for provider abstraction and frontend streaming.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Phase 1: Replace runtime.ts with LangGraph StateGraph](#2-phase-1-replace-runtimets-with-langgraph-stategraph)
3. [Phase 2: Selective Human-in-the-Loop](#3-phase-2-selective-human-in-the-loop)
4. [Phase 3: Multi-Agent Supervisor Routing](#4-phase-3-multi-agent-supervisor-routing)
5. [DB Migrations](#5-db-migrations)
6. [Files Summary](#6-files-summary)

---

## 1. Architecture Overview

### Current Stack

```
WhatsApp Webhook → Inngest (durable) → runtime.ts (hand-rolled ReAct loop) → AI SDK generateText() → Gemini → Reply
```

### Target Stack

```
WhatsApp Webhook → Inngest (durable) → LangGraph StateGraph → ChatGoogleGenerativeAI (LangChain) → Reply
                                            ↓ (bridge)
                                      @ai-sdk/langchain adapter
                                            ↓
                                      AI SDK useChat / streaming (for dashboard)
```

### What Changes vs. What Stays

| Stays unchanged | Gets replaced/added |
|-----------------|---------------------|
| `lib/agents/registry.ts` (14 tools) | `lib/agents/runtime.ts` → thin LangGraph wrapper |
| `lib/agents/errors.ts` | `lib/agents/graph/` (new directory, 6+ files) |
| `lib/agents/pricing.ts` | `@langchain/langgraph`, `@langchain/core`, `@langchain/google-genai`, `@ai-sdk/langchain` |
| `lib/agents/tenant-runtime.ts` | DB migration: `agent_tools.approval_required` + `agent_pending_actions` |
| `lib/agents/tenant-tools.ts` | `app/dashboard/agents/[agentId]/page.tsx` → per-tool HITL toggle |
| `lib/inngest/` (all 10 functions) | `lib/services/agents.ts` → `approval_required` in get/update |
| `lib/services/` (except agents.ts) | `app/api/.../agents/[agentId]/route.ts` → pass through HITL |
| `lib/channels/` (all adapters) | `components/pending-action-card.tsx` → approval UI |

### Packages to Install

```bash
npm install @langchain/langgraph @langchain/core @langchain/google-genai @ai-sdk/langchain
```

| Package | Purpose |
|---------|---------|
| `@langchain/langgraph` | StateGraph, checkpointing, HITL |
| `@langchain/core` | BaseMessage, tool abstraction, messages |
| `@langchain/google-genai` | ChatGoogleGenerativeAI (LangGraph's LLM) |
| `@ai-sdk/langchain` | Bridge: converts between AI SDK and LangChain formats |

---

## 2. Phase 1: Replace runtime.ts with LangGraph StateGraph

### 2.1 New File: `lib/agents/graph/state.ts`

```typescript
// NEW — lib/agents/graph/state.ts
import { Annotation } from "@langchain/langgraph";
import { BaseMessage } from "@langchain/core/messages";

/**
 * Agent state definition. Every node reads from and writes to this state.
 * Messages accumulate via the reducer (concatenation).
 */
export const AgentState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (curr, prev) => [...curr, ...prev],
    default: () => [],
  }),
  iteration: Annotation<number>({
    reducer: (_, prev) => prev,
    default: () => 0,
  }),
  metadata: Annotation<{
    tenantId: string;
    conversationId: string;
    contactId: string;
    customerName?: string;
    agentId: string;
    modelName: string;
  }>({
    reducer: (_, prev) => prev,
    default: () => ({} as any),
  }),
});
```

### 2.2 New File: `lib/agents/graph/tools.ts`

```typescript
// NEW — lib/agents/graph/tools.ts
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { tools, type AgentToolCtx } from "@/lib/agents/registry";

/**
 * Convert the existing AI SDK tool registry into LangChain tools.
 * Each tool wraps the original execute() with the agent context.
 */
export function buildLangChainTools(
  enabledTools: string[],
  ctx: AgentToolCtx,
) {
  const result: ReturnType<typeof tool>[] = [];

  for (const [name, def] of Object.entries(tools)) {
    if (!enabledTools.includes(name)) continue;

    result.push(
      tool(
        async (args: Record<string, unknown>) => {
          return await def.execute(ctx, args);
        },
        {
          name,
          description: def.description,
          schema: def.parameters as z.ZodObject<any>,
        },
      ),
    );
  }

  return result;
}
```

### 2.3 New File: `lib/agents/graph/nodes.ts`

```typescript
// NEW — lib/agents/graph/nodes.ts
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { AgentState } from "./state";
import { buildLangChainTools } from "./tools";
import { getBusinessContextPrompt } from "@/lib/services/businesses";

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

/**
 * Build the system prompt for an agent.
 */
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

/**
 * The agent node: calls the LLM and returns tool calls or a final response.
 */
export function createAgentNode(
  modelName: string,
  systemPrompt: string,
  tools: ReturnType<typeof buildLangChainTools>,
) {
  const llm = new ChatGoogleGenerativeAI({
    model: modelName,
    temperature: 0.7,
  }).bindTools(tools);

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

/**
 * Tool node: executes all tool calls from the last AI message.
 */
export function createToolNode(
  tools: ReturnType<typeof buildLangChainTools>,
) {
  return new ToolNode(tools);
}
```

### 2.4 New File: `lib/agents/graph/edges.ts`

```typescript
// NEW — lib/agents/graph/edges.ts
import { AIMessage } from "@langchain/core/messages";
import { END } from "@langchain/langgraph";
import { AgentState } from "./state";

const MAX_ITERATIONS = 6;

/**
 * After the agent node runs, decide: call tools or end?
 */
export function shouldContinue(state: typeof AgentState.State) {
  const lastMessage = state.messages[state.messages.length - 1];

  if (
    !(lastMessage instanceof AIMessage) ||
    !lastMessage.tool_calls?.length
  ) {
    return END;
  }

  if (state.iteration >= MAX_ITERATIONS) {
    return END;
  }

  return "tools";
}
```

### 2.5 New File: `lib/agents/graph/graph.ts`

```typescript
// NEW — lib/agents/graph/graph.ts
import { StateGraph, START, END, MemorySaver } from "@langchain/langgraph";
import { AgentState } from "./state";
import { createAgentNode, createToolNode, buildSystemPrompt } from "./nodes";
import { buildLangChainTools } from "./tools";
import { shouldContinue } from "./edges";
import type { AgentToolCtx } from "@/lib/agents/registry";

/**
 * In-memory checkpointer. Since Inngest provides durability at the
 * outer layer, MemorySaver is sufficient for the inner LangGraph loop.
 */
const checkpointer = new MemorySaver();

export interface BuildGraphInput {
  agent: {
    instructions: string;
    model_config: Record<string, unknown>;
    tools: string[];
  };
  ctx: AgentToolCtx;
}

/**
 * Build and compile the agent graph.
 */
export async function buildAgentGraph(input: BuildGraphInput) {
  const modelName =
    (input.agent.model_config?.model as string | undefined) ??
    process.env.AI_MODEL ??
    "gemini-3.1-flash-lite";

  const tools = buildLangChainTools(input.agent.tools, input.ctx);
  const systemPrompt = await buildSystemPrompt(
    input.agent.instructions,
    input.ctx.tenantId,
    input.agent.tools,
  );

  const agentNode = createAgentNode(modelName, systemPrompt, tools);
  const toolNode = createToolNode(tools);

  const graph = new StateGraph(AgentState)
    .addNode("agent", agentNode)
    .addNode("tools", toolNode)
    .addEdge(START, "agent")
    .addConditionalEdges("agent", shouldContinue, {
      [END]: END,
      tools: "tools",
    })
    .addEdge("tools", "agent");

  return graph.compile({ checkpointer });
}
```

### 2.6 New File: `lib/agents/graph/index.ts`

```typescript
// NEW — lib/agents/graph/index.ts
export { buildAgentGraph } from "./graph";
export { AgentState } from "./state";
export type { BuildGraphInput } from "./graph";
```

### 2.7 Modified File: `lib/agents/runtime.ts`

**BEFORE (current — 210 lines):**

```typescript
import { generateText, type ModelMessage, type ToolContent } from "ai";
import { google } from "@ai-sdk/google";
import { buildAgentTools, type AgentToolCtx } from "./registry";
import { AgentToolError } from "./errors";
import { calculateCost } from "./pricing";
import { getBusinessContextPrompt } from "@/lib/services/businesses";

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
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
  cost: number;
}

const DEFAULT_MODEL = "gemini-3.1-flash-lite";

// ... 150+ lines of hand-rolled ReAct loop with step.run() checkpointing,
//     tool execution, message accumulation, cost tracking
```

**AFTER (rewritten — ~80 lines):**

```typescript
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import { buildAgentGraph, type BuildGraphInput } from "./graph/graph";
import { calculateCost } from "./pricing";
import type { ModelMessage } from "ai";

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
  ctx: import("./registry").AgentToolCtx;
  history: ModelMessage[];
  step: DurableStep;
  logger?: { warn: (message: string, data?: Record<string, unknown>) => void };
  maxIterations?: number;
}

export interface AgentRunResult {
  text: string;
  iterations: number;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
  cost: number;
}

const DEFAULT_MODEL = "gemini-3.1-flash-lite";

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

  const graph = await input.step.run("build-graph", async () => {
    return buildAgentGraph({
      agent: {
        instructions: input.agent.instructions,
        model_config: input.agent.model_config,
        tools: input.agent.tools,
      },
      ctx: input.ctx,
    });
  });

  const messages = toLangChainMessages(input.history);
  const lastUserMsg = input.history[input.history.length - 1];
  const userMessage = new HumanMessage(
    typeof lastUserMsg?.content === "string"
      ? lastUserMsg.content
      : JSON.stringify(lastUserMsg?.content ?? ""),
  );

  const result = await input.step.run("invoke-graph", async () => {
    return graph.invoke(
      { messages: [...messages, userMessage], iteration: 0 },
      { configurable: { thread_id: input.ctx.conversationId } },
    );
  });

  const lastMessage = result.messages[result.messages.length - 1];
  const text = lastMessage?.content
    ? typeof lastMessage.content === "string"
      ? lastMessage.content
      : JSON.stringify(lastMessage.content)
    : "";

  const iterations = result.iteration ?? 1;
  const usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  const cost = calculateCost(modelName, usage.inputTokens, usage.outputTokens);

  return { text, iterations, usage, cost };
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
```

### 2.8 What Does NOT Change (Phase 1)

**`lib/inngest/functions/message-inbound.ts`** — zero changes:

```typescript
// message-inbound.ts line 90 — UNCHANGED
const result = await runDurableAgent({
  agent: {
    id: agent.id,
    type: agent.type,
    name: agent.name,
    instructions: agent.instructions,
    model_config: agent.model_config,
    tools: agent.tools,
  },
  ctx: { tenantId: d.tenantId, conversationId: d.conversationId, contactId: d.contactId, customerName: ctx.conversationContext.contact.full_name },
  history: ctx.history,
  step,
  logger: { warn: (message, data) => logger.warn(message, data) },
});
```

All other files — `registry.ts`, `tenant-runtime.ts`, `tenant-tools.ts`, `errors.ts`, `pricing.ts`, `date-validation.ts` — remain unchanged.

---

## 3. Phase 2: Selective Human-in-the-Loop

### 3.1 Concept

HITL is **selective** and **tenant-toggleable**. Each tool per agent has an `approval_required` flag that the tenant can toggle in the dashboard. The agent editor page gets a secondary "lock" icon next to each tool toggle — when locked, that tool requires human approval before execution.

**Default on (after migration):**
- `send_template` — irreversible WhatsApp message
- `create_booking` — real appointment on staff calendar
- `cancel_booking` — cancels an existing appointment
- `trigger_flow` — sends interactive WhatsApp Flow
- `create_template` — submits template to Meta for review

**Default off:**
- `search_knowledge_base`, `check_availability`, `list_resources`, `list_templates`, `list_flows`, `get_current_datetime`, `escalate_to_human`, `schedule_reminder`

Tenants can change any tool's approval requirement at any time via the agent editor.

### 3.2 DB Migration

```sql
-- supabase/migrations/20260824000000_add_hitl.sql

ALTER TABLE agent_tools
  ADD COLUMN approval_required boolean DEFAULT false;

CREATE TABLE agent_pending_actions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  thread_id text NOT NULL,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  tool_name text NOT NULL,
  tool_args jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by uuid,
  reviewed_at timestamptz,
  rejection_reason text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_pending_actions_thread ON agent_pending_actions(thread_id);
CREATE INDEX idx_pending_actions_tenant ON agent_pending_actions(tenant_id, status);
CREATE INDEX idx_pending_actions_conversation ON agent_pending_actions(conversation_id, status);

-- Default approval for high-stakes tools
UPDATE agent_tools SET approval_required = true
WHERE tool_name IN ('send_template', 'create_booking', 'cancel_booking', 'trigger_flow', 'create_template');
```

### 3.3 New File: `lib/agents/graph/hitl.ts`

```typescript
// NEW — lib/agents/graph/hitl.ts
import { supabaseAdmin } from "@/lib/clients/supabase";
import type { AgentToolCtx } from "@/lib/agents/registry";

export const HITL_CONTROLLED_TOOLS = new Set([
  "send_template",
  "create_booking",
  "cancel_booking",
  "trigger_flow",
  "create_template",
]);

export async function requiresApproval(
  agentId: string,
  toolName: string,
): Promise<boolean> {
  if (!HITL_CONTROLLED_TOOLS.has(toolName)) return false;

  const { data } = await supabaseAdmin()
    .from("agent_tools")
    .select("approval_required")
    .eq("agent_id", agentId)
    .eq("tool_name", toolName)
    .eq("enabled", true)
    .maybeSingle();

  return data?.approval_required ?? false;
}

export async function storePendingAction(params: {
  threadId: string;
  ctx: AgentToolCtx;
  toolName: string;
  toolArgs: Record<string, unknown>;
}) {
  await supabaseAdmin().from("agent_pending_actions").insert({
    thread_id: params.threadId,
    tenant_id: params.ctx.tenantId,
    conversation_id: params.ctx.conversationId,
    tool_name: params.toolName,
    tool_args: params.toolArgs,
    status: "pending",
  });
}

export async function approvePendingAction(
  actionId: string,
  reviewedBy?: string,
): Promise<{ success: boolean; error?: string }> {
  const { data: action, error: fetchError } = await supabaseAdmin()
    .from("agent_pending_actions")
    .select("*")
    .eq("id", actionId)
    .eq("status", "pending")
    .maybeSingle();

  if (fetchError || !action) {
    return { success: false, error: "Pending action not found or already processed." };
  }

  await supabaseAdmin()
    .from("agent_pending_actions")
    .update({
      status: "approved",
      reviewed_by: reviewedBy ?? null,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", actionId);

  return { success: true };
}

export async function rejectPendingAction(
  actionId: string,
  reason: string,
  reviewedBy?: string,
): Promise<{ success: boolean; error?: string }> {
  const { data: action, error: fetchError } = await supabaseAdmin()
    .from("agent_pending_actions")
    .select("*")
    .eq("id", actionId)
    .eq("status", "pending")
    .maybeSingle();

  if (fetchError || !action) {
    return { success: false, error: "Pending action not found or already processed." };
  }

  await supabaseAdmin()
    .from("agent_pending_actions")
    .update({
      status: "rejected",
      reviewed_by: reviewedBy ?? null,
      reviewed_at: new Date().toISOString(),
      rejection_reason: reason,
    })
    .eq("id", actionId);

  return { success: true };
}
```

### 3.4 Modified File: `lib/agents/graph/nodes.ts` (addition)

```typescript
// ADDITION to lib/agents/graph/nodes.ts — new function + imports

import { ToolMessage } from "@langchain/core/messages";
import { requiresApproval, storePendingAction } from "./hitl";

/**
 * HITL-aware tool node: intercepts tool calls that require approval,
 * stores them as pending, and returns a rejection message to the agent.
 */
export function createHitlToolNode(
  tools: ReturnType<typeof buildLangChainTools>,
  agentId: string,
) {
  const toolNode = new ToolNode(tools);

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
            tool_call_id: tc.id,
          }),
        );
      } else {
        const tool = tools.find((t) => t.name === tc.name);
        if (tool) {
          const output = await tool.invoke(tc.args);
          results.push(
            new ToolMessage({ content: output, tool_call_id: tc.id }),
          );
        }
      }
    }

    return { messages: results };
  };
}
```

### 3.5 Modified File: `app/dashboard/agents/[agentId]/page.tsx` (Tools Card update)

The existing agent editor has a 2-column grid of tool toggles. We add a secondary "lock" toggle per tool for approval_required. The lock only appears when the tool is enabled.

**BEFORE (existing Tools Card — simplified):**

```tsx
// BEFORE — app/dashboard/agents/[agentId]/page.tsx (Tools Card, ~60 lines)
const TOOL_LABELS: Record<string, string> = {
  search_knowledge_base: "Search Knowledge Base",
  check_availability: "Check Availability",
  create_booking: "Create Booking",
  cancel_booking: "Cancel Booking",
  list_resources: "List Resources",
  schedule_reminder: "Schedule Reminder",
  escalate_to_human: "Escalate to Human",
  list_templates: "List Templates",
  send_template: "Send Template",
  create_template: "Create Template",
  list_flows: "List Flows",
  trigger_flow: "Trigger Flow",
  get_current_datetime: "Get Date/Time",
};

// In the component:
const [tools, setTools] = useState<string[]>(agent.tools ?? []);

// Tools Card rendering:
<Card>
  <CardHeader>
    <CardTitle>Tools</CardTitle>
  </CardHeader>
  <CardContent>
    <div className="grid grid-cols-2 gap-2">
      {Object.entries(TOOL_LABELS).map(([id, label]) => {
        const enabled = tools.includes(id);
        return (
          <Button
            key={id}
            variant={enabled ? "default" : "outline"}
            size="sm"
            onClick={() => {
              setTools(prev =>
                enabled ? prev.filter(t => t !== id) : [...prev, id]
              );
            }}
          >
            {label}
            <Badge variant={enabled ? "secondary" : "outline"}>
              {enabled ? "On" : "Off"}
            </Badge>
          </Button>
        );
      })}
    </div>
  </CardContent>
</Card>
```

**AFTER (Tools Card with per-tool HITL toggle):**

```tsx
// AFTER — app/dashboard/agents/[agentId]/page.tsx (Tools Card with approval_required)

import { Lock, Unlock } from "lucide-react";
import { Switch } from "@/components/ui/switch";

const TOOL_LABELS: Record<string, string> = {
  search_knowledge_base: "Search Knowledge Base",
  check_availability: "Check Availability",
  create_booking: "Create Booking",
  cancel_booking: "Cancel Booking",
  list_resources: "List Resources",
  schedule_reminder: "Schedule Reminder",
  escalate_to_human: "Escalate to Human",
  list_templates: "List Templates",
  send_template: "Send Template",
  create_template: "Create Template",
  list_flows: "List Flows",
  trigger_flow: "Trigger Flow",
  get_current_datetime: "Get Date/Time",
};

// Tools that are HITL-eligible (can require approval)
const HITL_ELIGIBLE = new Set([
  "send_template", "create_booking", "cancel_booking",
  "trigger_flow", "create_template",
]);

// State:
const [tools, setTools] = useState<string[]>(agent.tools ?? []);
const [approvalRequired, setApprovalRequired] = useState<Record<string, boolean>>(
  agent.approval_required ?? {}  // { send_template: true, create_booking: true, ... }
);

// Tools Card rendering:
<Card>
  <CardHeader>
    <CardTitle>Tools</CardTitle>
    <CardDescription>
      Toggle tools on/off. Click the lock icon to require human approval before execution.
    </CardDescription>
  </CardHeader>
  <CardContent>
    <div className="grid grid-cols-2 gap-2">
      {Object.entries(TOOL_LABELS).map(([id, label]) => {
        const enabled = tools.includes(id);
        const isLocked = approvalRequired[id] ?? false;
        const isHitlEligible = HITL_ELIGIBLE.has(id);

        return (
          <div key={id} className="flex items-center gap-2">
            <Button
              variant={enabled ? "default" : "outline"}
              size="sm"
              className="flex-1 justify-between"
              onClick={() => {
                setTools(prev =>
                  enabled ? prev.filter(t => t !== id) : [...prev, id]
                );
              }}
            >
              {label}
              <Badge variant={enabled ? "secondary" : "outline"}>
                {enabled ? "On" : "Off"}
              </Badge>
            </Button>

            {enabled && isHitlEligible && (
              <div className="flex items-center gap-1" title={isLocked ? "Requires approval" : "Auto-executes"}>
                {isLocked ? (
                  <Lock className="h-4 w-4 text-amber-500" />
                ) : (
                  <Unlock className="h-4 w-4 text-muted-foreground" />
                )}
                <Switch
                  checked={isLocked}
                  onCheckedChange={(checked) => {
                    setApprovalRequired(prev => ({ ...prev, [id]: checked }));
                  }}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  </CardContent>
</Card>
```

**Save action update:**

```typescript
// BEFORE — save payload
const payload = { name, type, instructions, enabled, tools };

// AFTER — save payload includes approval_required
const payload = {
  name,
  type,
  instructions,
  enabled,
  tools,
  approval_required: approvalRequired,  // { send_template: true, create_booking: false, ... }
};
```

### 3.6 Modified File: `lib/services/agents.ts` (service layer)

```typescript
// BEFORE — UpdateAgentInput
interface UpdateAgentInput {
  type?: string;
  name?: string;
  instructions?: string;
  model_config?: Record<string, unknown>;
  enabled?: boolean;
  tools?: string[];
}

// AFTER — UpdateAgentInput
interface UpdateAgentInput {
  type?: string;
  name?: string;
  instructions?: string;
  model_config?: Record<string, unknown>;
  enabled?: boolean;
  tools?: string[];
  approval_required?: Record<string, boolean>;  // NEW: per-tool approval flag
}
```

```typescript
// BEFORE — updateAgent function (tool re-seeding)
if (input.tools) {
  await admin.from("agent_tools").delete().eq("agent_id", agentId);
  const rows = input.tools.map((tool_name) => ({
    agent_id: agentId,
    tool_name,
    config: {},
    enabled: true,
  }));
  await admin.from("agent_tools").insert(rows);
}

// AFTER — updateAgent function (tool re-seeding with approval_required)
if (input.tools) {
  await admin.from("agent_tools").delete().eq("agent_id", agentId);
  const rows = input.tools.map((tool_name) => ({
    agent_id: agentId,
    tool_name,
    config: {},
    enabled: true,
    approval_required: input.approval_required?.[tool_name] ?? false,
  }));
  await admin.from("agent_tools").insert(rows);
}
```

### 3.7 Modified File: `app/api/tenants/[tenantId]/agents/[agentId]/route.ts` (API)

```typescript
// BEFORE — PATCH handler (simplified)
const body = await req.json();
const result = await updateAgent(tenantId, agentId, body);
return Response.json(result);

// AFTER — PATCH handler (passes through approval_required)
const body = await req.json();
const result = await updateAgent(tenantId, agentId, {
  ...body,
  approval_required: body.approval_required,  // pass through to service
});
return Response.json(result);
```

### 3.8 Modified File: `app/api/tenants/[tenantId]/agents/[agentId]/route.ts` (GET — return approval_required)

```typescript
// BEFORE — GET returns agent with tools
const agent = await getAgent(tenantId, agentId);
// agent.tools = ["search_knowledge_base", "send_template", ...]

// AFTER — GET returns agent with tools + approval_required
const agent = await getAgent(tenantId, agentId);
// agent.tools = ["search_knowledge_base", "send_template", ...]
// agent.approval_required = { send_template: true, create_booking: true, ... }
```

This requires updating the `getAgent` function in `lib/services/agents.ts` to query `approval_required` from `agent_tools` and return it as a record:

```typescript
// ADDITION to lib/services/agents.ts — getAgent function

// After fetching the agent and its tools:
const tools = unwrap(
  await admin
    .from("agent_tools")
    .select("tool_name, approval_required")
    .eq("agent_id", agentRow.id)
    .eq("enabled", true),
);

const toolNames = tools.map((t: { tool_name: string }) => t.tool_name);
const approvalRequired: Record<string, boolean> = {};
for (const t of tools) {
  if (t.approval_required) {
    approvalRequired[t.tool_name] = true;
  }
}

return { ...agentRow, tools: toolNames, approval_required: approvalRequired };
```

### 3.9 New API Route: `app/api/tenants/[tenantId]/agent/approve/route.ts`

```typescript
import { NextRequest, NextResponse } from "next/server";
import { requireTenantAccess } from "@/lib/auth";
import { approvePendingAction, rejectPendingAction } from "@/lib/agents/graph/hitl";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> },
) {
  const { tenantId } = await params;
  const auth = await requireTenantAccess(tenantId);
  if (auth.error) return auth.error;

  const body = await req.json();
  const { actionId, action, reason } = body as {
    actionId: string;
    action: "approve" | "reject";
    reason?: string;
  };

  if (!actionId || !action) {
    return NextResponse.json({ error: "actionId and action required" }, { status: 400 });
  }

  if (action === "approve") {
    const result = await approvePendingAction(actionId, auth.user.id);
    if (!result.success) return NextResponse.json({ error: result.error }, { status: 404 });
    return NextResponse.json({ ok: true });
  }

  if (action === "reject") {
    const result = await rejectPendingAction(actionId, reason ?? "Rejected", auth.user.id);
    if (!result.success) return NextResponse.json({ error: result.error }, { status: 404 });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
```

### 3.10 New Component: `components/pending-action-card.tsx`

```tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";

interface PendingAction {
  id: string;
  tool_name: string;
  tool_args: Record<string, unknown>;
  conversation_id: string;
  created_at: string;
}

export function PendingActionCard({
  action,
  tenantId,
  onResolved,
}: {
  action: PendingAction;
  tenantId: string;
  onResolved: () => void;
}) {
  const [loading, setLoading] = useState(false);

  async function handleAction(type: "approve" | "reject") {
    setLoading(true);
    try {
      const res = await fetch(`/api/tenants/${tenantId}/agent/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actionId: action.id, action: type }),
      });
      if (!res.ok) throw new Error("Failed");
      toast.success(type === "approve" ? "Approved" : "Rejected");
      onResolved();
    } catch {
      toast.error("Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="border-amber-200 bg-amber-50">
      <CardHeader>
        <CardTitle className="text-sm">
          Pending: {action.tool_name.replace(/_/g, " ")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <pre className="text-xs text-muted-foreground mb-3 overflow-auto max-h-32">
          {JSON.stringify(action.tool_args, null, 2)}
        </pre>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => handleAction("approve")} disabled={loading}>
            Approve
          </Button>
          <Button size="sm" variant="outline" onClick={() => handleAction("reject")} disabled={loading}>
            Reject
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
```

---

## 4. Phase 3: Multi-Agent Supervisor Routing

### 4.1 Concept

Replace the single agent with a **supervisor graph** that routes inbound messages to specialized sub-agents.

| Sub-Agent | Tools | Model |
|-----------|-------|-------|
| FAQ | `search_knowledge_base`, `get_current_datetime`, `escalate_to_human` | gemini-3.1-flash-lite |
| Booking | `check_availability`, `create_booking`, `cancel_booking`, `list_resources`, `schedule_reminder`, `get_current_datetime`, `escalate_to_human` | gemini-1.5-pro |
| Template | `list_templates`, `send_template`, `list_flows`, `trigger_flow`, `escalate_to_human` | gemini-3.1-flash-lite |
| Escalation | `escalate_to_human` | gemini-3.1-flash-lite |

### 4.2 New File: `lib/agents/graph/supervisor.ts`

```typescript
import { StateGraph, START, END, Annotation } from "@langchain/langgraph";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { AgentState } from "./state";
import { createAgentNode, buildSystemPrompt } from "./nodes";
import { buildLangChainTools } from "./tools";
import type { AgentToolCtx } from "@/lib/agents/registry";

const SupervisorState = Annotation.Root({
  ...AgentState.spec,
  next: Annotation<string>({
    reducer: (_, prev) => prev,
    default: () => "",
  }),
});

const ROUTE_MAP: Record<string, { tools: string[]; prompt: string; model?: string }> = {
  faq: {
    tools: ["search_knowledge_base", "get_current_datetime", "escalate_to_human"],
    prompt: `You are a FAQ specialist. Answer customer questions using the knowledge base.
Search the KB first. If you can't find the answer, escalate to a human.
Never invent business facts.`,
    model: "gemini-3.1-flash-lite",
  },
  booking: {
    tools: ["check_availability", "create_booking", "cancel_booking", "list_resources", "schedule_reminder", "get_current_datetime", "escalate_to_human"],
    prompt: `You are a booking specialist. Help customers book, reschedule, or cancel appointments.
Always check availability before suggesting times. After creating a booking, schedule a reminder.`,
    model: "gemini-1.5-pro",
  },
  template: {
    tools: ["list_templates", "send_template", "list_flows", "trigger_flow", "escalate_to_human"],
    prompt: `You are a WhatsApp template specialist. Help customers interact with templates and flows.
Use list_templates to see what's available before sending.`,
    model: "gemini-3.1-flash-lite",
  },
  escalation: {
    tools: ["escalate_to_human"],
    prompt: `You are an escalation specialist. The customer needs to talk to a human.
Use escalate_to_human immediately with a clear reason.`,
    model: "gemini-3.1-flash-lite",
  },
};

function createSupervisorNode(modelName: string) {
  const llm = new ChatGoogleGenerativeAI({ model: modelName, temperature: 0 });

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
  const supervisorNode = createSupervisorNode("gemini-3.1-flash-lite");

  const subAgentNodes: Record<string, any> = {};

  for (const [category, config] of Object.entries(ROUTE_MAP)) {
    const agentTools = config.tools.filter((t) => input.enabledTools.includes(t));
    if (agentTools.length === 0) continue;

    const tools = buildLangChainTools(agentTools, input.ctx);
    const systemPrompt = await buildSystemPrompt(
      `${input.instructions}\n\n${config.prompt}`,
      input.ctx.tenantId,
      agentTools,
    );

    subAgentNodes[category] = createAgentNode(
      config.model ?? "gemini-3.1-flash-lite",
      systemPrompt,
      tools,
    );
  }

  const graph = new StateGraph(SupervisorState)
    .addNode("supervisor", supervisorNode);

  for (const [category, nodeFn] of Object.entries(subAgentNodes)) {
    graph.addNode(category, nodeFn);
  }

  graph.addConditionalEdges("supervisor", (state) => state.next, {
    ...Object.fromEntries(Object.keys(subAgentNodes).map((k) => [k, k])),
  });

  for (const category of Object.keys(subAgentNodes)) {
    graph.addEdge(category, END);
  }

  graph.addEdge(START, "supervisor");

  return graph.compile();
}
```

### 4.3 Modified File: `lib/agents/runtime.ts` (Phase 3 addition)

```typescript
// ADDITION — inside runDurableAgent, graph building step:
import { buildSupervisorGraph } from "./graph/supervisor";

const graph = await input.step.run("build-graph", async () => {
  if (input.agent.type === "supervisor") {
    return buildSupervisorGraph({
      agentId: input.agent.id,
      instructions: input.agent.instructions,
      model_config: input.agent.model_config,
      enabledTools: input.agent.tools,
      ctx: input.ctx,
    });
  }

  return buildAgentGraph({
    agent: {
      instructions: input.agent.instructions,
      model_config: input.agent.model_config,
      tools: input.agent.tools,
    },
    ctx: input.ctx,
  });
});
```

---

## 5. DB Migrations

### Migration 1: HITL fields (Phase 2)

```sql
-- supabase/migrations/20260824000000_add_hitl.sql

ALTER TABLE agent_tools
  ADD COLUMN approval_required boolean DEFAULT false;

CREATE TABLE agent_pending_actions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  thread_id text NOT NULL,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  tool_name text NOT NULL,
  tool_args jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by uuid,
  reviewed_at timestamptz,
  rejection_reason text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_pending_actions_thread ON agent_pending_actions(thread_id);
CREATE INDEX idx_pending_actions_tenant ON agent_pending_actions(tenant_id, status);
CREATE INDEX idx_pending_actions_conversation ON agent_pending_actions(conversation_id, status);

UPDATE agent_tools SET approval_required = true
WHERE tool_name IN ('send_template', 'create_booking', 'cancel_booking', 'trigger_flow', 'create_template');
```

---

## 6. Files Summary

### New Files

| File | Phase | Purpose |
|------|-------|---------|
| `lib/agents/graph/state.ts` | 1 | LangGraph state definition |
| `lib/agents/graph/tools.ts` | 1 | Convert AI SDK tools → LangChain tools |
| `lib/agents/graph/nodes.ts` | 1 | Agent + tool nodes |
| `lib/agents/graph/edges.ts` | 1 | Conditional routing |
| `lib/agents/graph/graph.ts` | 1 | Graph assembly + compilation |
| `lib/agents/graph/index.ts` | 1 | Barrel export |
| `lib/agents/graph/hitl.ts` | 2 | HITL approval logic |
| `app/api/tenants/[tenantId]/agent/approve/route.ts` | 2 | Approval API endpoint |
| `components/pending-action-card.tsx` | 2 | Dashboard approval UI |
| `lib/agents/graph/supervisor.ts` | 3 | Multi-agent supervisor routing |

### Modified Files

| File | Phase | Change |
|------|-------|--------|
| `lib/agents/runtime.ts` | 1, 3 | Replaced 210-line ReAct loop with ~80-line LangGraph wrapper |
| `lib/agents/graph/nodes.ts` | 2 | Added `createHitlToolNode` |
| `lib/agents/graph/graph.ts` | 2 | Switch to HITL-aware tool node |
| `app/dashboard/agents/[agentId]/page.tsx` | 2 | Added per-tool lock toggle in Tools Card |
| `lib/services/agents.ts` | 2 | Added `approval_required` to UpdateAgentInput + getAgent return |
| `app/api/tenants/[tenantId]/agents/[agentId]/route.ts` | 2 | Pass through `approval_required` in PATCH + GET |

### Unchanged Files

| File | Why unchanged |
|------|---------------|
| `lib/agents/registry.ts` | Tools stay in AI SDK format, wrapped by `graph/tools.ts` |
| `lib/agents/errors.ts` | Used by tools, not by graph |
| `lib/agents/pricing.ts` | Cost calculation stays the same |
| `lib/agents/tenant-runtime.ts` | Dashboard chat uses AI SDK streaming directly |
| `lib/agents/tenant-tools.ts` | Tenant tools stay in AI SDK format |
| `lib/agents/date-validation.ts` | Used by tools, not by graph |
| `lib/inngest/` (all) | Inngest is the outer durable layer |
| `lib/services/` (all) | Data access layer stays the same |
| `lib/channels/` (all) | Channel adapters stay the same |
| `app/api/` (except approve route + agent/[agentId] route) | No changes |
| `components/` (except new card) | No changes |

---

## 7. Implementation Order

```
Week 1-2 (Phase 1):
  □ npm install @langchain/langgraph @langchain/core @langchain/google-genai @ai-sdk/langchain
  □ Create lib/agents/graph/ directory
  □ Create state.ts, tools.ts, nodes.ts, edges.ts, graph.ts, index.ts
  □ Rewrite runtime.ts
  □ Test: agent responds to WhatsApp messages via LangGraph
  □ Verify all 14 tools execute through the new graph

Week 3 (Phase 2):
  □ Run migration: add_hitl.sql
  □ Create lib/agents/graph/hitl.ts
  □ Update nodes.ts with createHitlToolNode
  □ Update graph.ts to use HITL-aware node
  □ Create approve API route
  □ Create PendingActionCard component
  □ Update agent editor page: add per-tool lock toggles
  □ Update lib/services/agents.ts: approval_required in getAgent + updateAgent
  □ Update agent API route: pass through approval_required
  □ Test: send_template pauses, approval resumes it
  □ Test: toggle approval_required in dashboard, verify it persists

Week 4 (Phase 3):
  □ Create lib/agents/graph/supervisor.ts
  □ Update runtime.ts to support agent.type === "supervisor"
  □ Create supervisor agent via admin dashboard
  □ Test: FAQ message → FAQ agent, booking request → booking agent
  □ Test: escalation when no specialist can help
```
