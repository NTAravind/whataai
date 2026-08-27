# LangGraph Integration Plan

**Date:** 2026-08-24
**Status:** Draft
**Goal:** Integrate LangGraph into WhataAI as the agent state machine, while keeping Vercel AI SDK for provider abstraction and frontend streaming.

---

## Table of Contents

0. [Known Issues to Resolve Before Building](#0-known-issues-to-resolve-before-building)
1. [Architecture Overview](#1-architecture-overview)
2. [Phase 1: Replace runtime.ts with LangGraph StateGraph](#2-phase-1-replace-runtimets-with-langgraph-stategraph)
3. [Phase 2: Selective Human-in-the-Loop](#3-phase-2-selective-human-in-the-loop)
4. [Phase 3: Multi-Agent Supervisor Routing](#4-phase-3-multi-agent-supervisor-routing)
5. [DB Migrations](#5-db-migrations)
6. [Files Summary](#6-files-summary)

---

## 0. Known Issues to Resolve Before Building

Found in review, prior to any implementation. Fixes for the first two are already applied inline below; the rest need a decision before you write code.

**Fixed in this doc:**
- **`state.metadata` was never populated on invoke** — defaulted to `{}`, so `createHitlToolNode`'s `storePendingAction()` would insert `tenant_id: undefined` and fail the `agent_pending_actions` FK constraint. Fixed in 2.7 by passing `metadata` into `graph.invoke()`.
- **Token usage was hardcoded to zero** — `calculateCost()` always returned 0, silently breaking plan-based usage metering and billing. Fixed in 2.7 by summing `usage_metadata` off every AI message generated in the turn.
- **`MemorySaver` checkpointer was unused dead weight** — nothing calls `interrupt()`, so it was never actually pausing/resuming the graph, and it's process-local so it wouldn't survive across serverless invocations anyway. Removed from 2.5; graph now compiles without a checkpointer until real interrupt-based HITL is built.

**Still needs a decision (not yet fixed — see inline callouts in Phase 2/3):**
- **Phase 2 approval never resumes anything.** `approvePendingAction()` only updates a DB row — nothing executes the approved tool or follows up with the customer. See the callout in §3.1 for the two implementation options.
- **`createHitlToolNode`'s manual tool execution has no error handling.** A thrown error from `tool.invoke()` currently crashes the node instead of becoming a recoverable `ToolMessage`. See callout in §3.1.
- **Booking sub-agent uses `gemini-1.5-pro` while everything else uses `gemini-3.1-flash-lite`** — confirm this generation mismatch is intentional (§4.1 table) rather than a copy-paste leftover, especially since booking is the most multi-step sub-agent.
- **No feature flag / gradual rollout for the runtime.ts swap.** This is the core reply path for every tenant — recommend keeping the existing AI-SDK runtime selectable per-tenant for a rollout window rather than a hard cutover.
- **`@ai-sdk/langchain` bridge is referenced in the architecture diagram (§1) but never used in any Phase 1 code shown** — confirm where it's actually meant to plug in (likely the dashboard's `useChat` streaming) before adding it as a dependency.
- **`buildLangChainTools` casts `def.parameters as z.ZodObject<any>`** — smoke-test all 14 tools against LangChain's `tool()` validator before assuming they all port cleanly, particularly any with non-object top-level schemas or unusual `.optional()`/`.refine()` chains.
- **Verify the `messages` reducer's argument order** in `state.ts` (`(curr, prev) => [...curr, ...prev]`) matches LangGraph's `(existing, update)` convention — as written it may prepend new messages before old ones.

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
| `lib/agents/tenant-runtime.ts` | DB migration: `agent_tools.approval_required` |
| `lib/agents/tenant-tools.ts` | DB migration: `agent_pending_actions` (Phase 2) |
| `lib/inngest/` (all 10 functions) | |
| `lib/services/` (all 20 files) | |
| `lib/channels/` (all adapters) | |
| `app/api/` (all routes) | |

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
import { StateGraph, START, END } from "@langchain/langgraph";
import { AgentState } from "./state";
import { createAgentNode, createToolNode, buildSystemPrompt } from "./nodes";
import { buildLangChainTools } from "./tools";
import { shouldContinue } from "./edges";
import type { AgentToolCtx } from "@/lib/agents/registry";

/**
 * NOTE (revised): Phase 1 and Phase 2's HITL implementation never call
 * interrupt()/Command.resume() — the graph always runs start-to-finish
 * inside a single invoke(), and runDurableAgent() reconstructs full
 * history from the DB on every call. A checkpointer is not actually used
 * for anything yet, and MemorySaver is process-local — it will not
 * persist across separate serverless invocations of the same
 * conversation anyway. Compile WITHOUT a checkpointer for Phase 1/2:
 *
 *   return graph.compile();
 *
 * Only reintroduce a checkpointer (a persistent, e.g. Postgres-backed
 * one — not MemorySaver) if/when real interrupt()-based HITL pause/resume
 * is built (see "Known issues to resolve before building" below). At that
 * point also stop passing full reconstructed history into every invoke(),
 * since the checkpoint becomes the source of truth — otherwise the
 * `messages` reducer ([...curr, ...prev]) will concatenate the
 * checkpoint's stored history on top of the freshly-passed-in history and
 * duplicate every prior turn.
 */

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

  return graph.compile();
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
      {
        messages: [...messages, userMessage],
        iteration: 0,
        // REQUIRED — without this, state.metadata defaults to {} and
        // createHitlToolNode's storePendingAction() call in Phase 2 inserts
        // tenant_id: undefined, which violates the NOT NULL FK on
        // agent_pending_actions and throws at runtime.
        metadata: {
          tenantId: input.ctx.tenantId,
          conversationId: input.ctx.conversationId,
          contactId: input.ctx.contactId,
          customerName: input.ctx.customerName,
          agentId: input.agent.id,
          modelName,
        },
      },
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

  // Sum usage across every AI message generated THIS turn (the ReAct loop
  // can call the model multiple times per turn), not just the final message.
  // Previously hardcoded to zero, which silently breaks plan-based usage
  // metering and billing the moment this ships.
  const inputMessageCount = messages.length + 1; // prior history + this turn's user message
  const generatedThisTurn = result.messages.slice(inputMessageCount);

  let inputTokens = 0;
  let outputTokens = 0;
  for (const m of generatedThisTurn) {
    if (m instanceof AIMessage && m.usage_metadata) {
      inputTokens += m.usage_metadata.input_tokens ?? 0;
      outputTokens += m.usage_metadata.output_tokens ?? 0;
    }
  }
  // Verify this field shape against the installed @langchain/google-genai
  // version — usage_metadata.{input_tokens,output_tokens} has been stable
  // for a while but has moved before across LangChain JS majors.

  const usage = { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens };
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

HITL is **selective** — only tools where `approval_required = true` in the `agent_tools` table pause for approval.

**Tools requiring approval (configurable per tenant):**
- `send_template` — irreversible WhatsApp message
- `create_booking` — real appointment on staff calendar
- `cancel_booking` — cancels an existing appointment
- `trigger_flow` — sends interactive WhatsApp Flow
- `create_template` — submits template to Meta for review

**Tools always autonomous:**
- `search_knowledge_base`, `check_availability`, `list_resources`, `list_templates`, `list_flows`, `get_current_datetime`, `escalate_to_human`, `schedule_reminder`

> **⚠️ Gap: this phase as drafted below is incomplete.** `approvePendingAction()` (3.3) only flips the DB row to `status: 'approved'` — nothing then actually executes `create_booking`/`send_template`/etc., and nothing follows up with the customer. Before building Phase 2, decide between:
> 1. A second Inngest function triggered off the approval that re-invokes the specific tool with `tool_args` and sends a follow-up WhatsApp message with the result, **or**
> 2. Real LangGraph `interrupt()` / `Command.resume()` so the graph itself pauses and resumes (requires a persistent, not in-memory, checkpointer — see 2.5's note on `MemorySaver`).
>
> The `createHitlToolNode` implementation below (3.4) also hand-rolls tool execution for the non-approval branch instead of reusing the prebuilt `ToolNode` — if `tool.invoke(tc.args)` throws (API failure, Supabase error), it currently crashes the node instead of surfacing an error `ToolMessage` the agent can recover from. Wrap that branch in try/catch.

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

### 3.5 New API Route: `app/api/tenants/[tenantId]/agent/approve/route.ts`

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

### 3.6 New Component: `components/pending-action-card.tsx`

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
| `app/api/` (except approve route) | No changes |
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
  □ Test: send_template pauses, approval resumes it

Week 4 (Phase 3):
  □ Create lib/agents/graph/supervisor.ts
  □ Update runtime.ts to support agent.type === "supervisor"
  □ Create supervisor agent via admin dashboard
  □ Test: FAQ message → FAQ agent, booking request → booking agent
  □ Test: escalation when no specialist can help
```
