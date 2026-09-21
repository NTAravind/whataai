# Backend Engineering Guide

A practical orientation for backend engineers joining the WA Agent Platform.
Read this before touching code. Companion docs:

| Doc | Purpose |
|---|---|
| `docs/guide.md` | Architecture principles, domain model, MVP roadmap |
| `docs/rest-api.md` | Every HTTP endpoint, request/response shapes |
| `docs/backend.md` | **This file** — how the backend is actually wired together |

---

## 1. What this is

A multi-tenant AI customer-service platform. Businesses receive WhatsApp (and
eventually mail) messages from their customers; an AI agent replies
automatically — answering from a knowledge base, booking appointments, sending
templates, escalating to a human.

**Stack:** Next.js 16.2 (App Router, server route handlers) · Supabase
(Auth/Postgres/RLS) · LangGraph + LangChain
(`@langchain/langgraph`, `@langchain/core`, `@langchain/google-genai`,
`@langchain/groq`) driving the agent state machine, with Vercel AI SDK
(`ai@7`, `@ai-sdk/google`, `@ai-sdk/groq`) powering the dashboard chat
streaming path · Inngest v4 (durable event pipeline / background jobs) ·
Meta Cloud API (WhatsApp) · Resend (mail).

**Providers:** every model — provider, id catalog, pricing, and SDK factories —
is defined once in `lib/agents/provider.ts`, which drives BOTH the AI-SDK
(`getAISDKModel`) and LangChain (`getLangChainModel`) paths. Switch providers
(Google ⇄ Groq) and add/retire models in that one file; see §5.1.

**Stack truth that matters:** this is a **jobs/event-driven backend wearing a
Next.js coat**. Route handlers are thin HTTP fronts — the real work happens in
Inngest functions. Never put LLM calls, Meta calls, or long-running work inline
in a route handler. The inbound agent reply is a LangGraph state machine (see
§5) driven from inside the durable `message-inbound` Inngest function; custom
automations are an Inngest pipeline (`automation/triggered` → `automation-run`,
see §4a) that steps through integration calls and WhatsApp sends.

---

## 2. Repo layout

```
app/api/                     route handlers only (thin)
  auth/callback/             Supabase OAuth callback
  auth/oauth/callback/       integration OAuth2 code→token exchange + redirect to /dashboard/oauth-result
  me/                        current-user endpoint
  admin/                     god-mode CRUD: tenants, plans, subscriptions, god-users
  tenants/[tenantId]/        tenant-scoped CRUD (see below)
  whatsapp/                  webhooks, flows, templates (create/delete/status),
                             message (send-text / send-template / services / utility)
  mail/webhooks/             Resend inbound
  inngest/                   Inngest SDK serving endpoint (maxDuration = 60)

app/privacy/                 public privacy page (not an API route)

lib/
  api/                       shared API client + types
  clients/supabase.ts        untyped admin (service-role) client + unwrap()
  clients/ingest.ts          Inngest v4 client
  supabase/browser.ts        browser Supabase client
  auth/guard.ts              session guards: requireUser / requireGodUser / requireTenantAccess
  http.ts                    HttpError + response/error helpers used by every route
  services/                  data-access layer — one file per aggregate (tenants, plans, bookings,
                             automations, integration, kb, chat-sessions, …). Every service filters
                             by tenant_id and throws HttpError.
  agents/                    agent logic: provider.ts (models/pricing/SDK factories — THE source
                             of truth), runtime.ts (durable LangGraph wrapper), graph/ (the state
                             machine, see §5), registry.ts (tool catalog — buildAgentTools appends
                             capture tools), tenant-runtime.ts + tenant-tools.ts (dashboard chat
                             tools), errors.ts, pricing.ts (re-exports calculateCost from
                             provider.ts), date-validation.ts
  agents/graph/              LangGraph: state.ts, nodes.ts, edges.ts, graph.ts, supervisor.ts,
                             tools.ts (async, appends capture tools), hitl.ts, index.ts
  automations/               custom automations: types.ts (Zod step/trigger schemas), capture-tool.ts
                             (AI-field-capture tools, named `capture_<automationId>`), executors.ts
                             (one executor per step type), trigger.ts (emit automation/triggered)
  integrations/              oauth-providers.ts (provider registry — the ONLY file that changes to
                             add a Zoho/QuickBooks/Xero-style provider), token-refresh.ts
                             (getValidAccessToken, refresh-token grant for every provider)
  channels/                  ChannelAdapter interface + registry + whatsapp/mail adapters
  crypto/credentials.ts      AES-256-GCM encrypt/decrypt for integration credentials at rest
  crypto/whatsapp-crypto.ts  WhatsApp Flow payload decryption + Meta webhook signature check
  entitlements/resolve.ts    plan limits → Entitlements resolution (+ token_budget_topup)
  inngest/functions/         every background function (incl. automation-run)
  inngest/events.ts          the typed event catalog (Inngest v4 `eventType()`) — source of truth for event shapes
  meta/whatsapp.ts           Meta Graph API calls (templates, send)
  format.ts                  formatCurrency (USD/INR) with Intl.NumberFormat

hooks/
  use-api.ts                 client-side API fetch wrapper
  use-currency.ts            client-side currency hook (syncs with tenant DB preference)

supabase/migrations/         SQL migrations, applied in order
docs/                        guide, rest-api reference, api-guide, llms/, this file
```

**Tenant-scoped routes** (`app/api/tenants/[tenantId]/`):

```
agent/ (approve/reject HITL)   agents/                        appointment-services/
automations/ (+ enabled-tools, [id]/, [id]/duplicate, [id]/runs)   availability-rules/
bookings/                      businesses/                   chat/ (+ chat/sessions/)
contacts/ (+ [contactId])      conversations/                currency/
entitlements/                  integrations/ (+ [id], oauth/start, oauth/status)
kb-documents/                  mail-accounts/                members/
resources/                     templates/                    usage/
wa-accounts/
```

Route handlers import `lib/services/*` — they never talk to Postgres or Meta
directly. Keep it that way.

---

## 3. Getting started locally

Prereqs: Node 20+, a Supabase project (local via `supabase start` or cloud),
an Inngest account/tunnel.

```bash
npm install
npm run dev            # Next on :3000
# in a second shell, run Inngest locally and point it at /api/inngest:
npx inngest-cli dev    # expects INNGEST_DEV=1 and the URL /api/inngest
```

Apply schema: run the files in `supabase/migrations/` **in filename order**
against your Supabase project (`.sql` files — `supabase db push`/`supabase
migration up`, or paste into the SQL editor). Then create at least one plan, one
tenant, a subscription, and add your own email to `god_users` before you can use
the admin API.

**Env vars** (copy `.env.example` if present, else `.env.local` — `.env*` is
gitignored):

| Variable | Required | Used by |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | yes | admin client, auth guard, browser client |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | auth guard (session cookie), browser client |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | admin client (bypasses RLS) |
| `GOOGLE_GENERATIVE_AI_API_KEY` | for google | Google Gemini via `@ai-sdk/google` *and* LangChain's `ChatGoogleGenerativeAI`. Note: `@ai-sdk/google` reads this env var automatically, but LangChain does **not** — it is passed explicitly via `getLangChainModel()` in `lib/agents/provider.ts`. |
| `GROQ_API_KEY` | for groq | Groq via `@ai-sdk/groq` *and* `ChatGroq` — used only if a model's provider is `groq` or `ACTIVE_PROVIDER` is switched in `lib/agents/provider.ts`. |
| `WHATSAPP_VERIFY_TOKEN` | for WA | webhook GET verification |
| `META_APP_SECRET` | for WA | webhook signature validation |
| `WHATSAPP_API_KEY` | for WA | Meta Graph API bearer token |
| `FLOW_PRIVATE_KEY_PEM`, `FLOW_PRIVATE_KEY_PASSPHRASE` | for flows | WhatsApp Flow payload decryption |
| `RESEND_API_KEY` | for mail | Resend adapter |
| `AI_MODEL` | no | default agent model (falls back to `DEFAULT_MODEL` in `lib/agents/provider.ts`) |
| `INNGEST_DEV` | dev | set to `"1"` to route Inngest calls to the local dev server |
| `INNGEST_SIGNING_KEY`, `INNGEST_EVENT_KEY` | prod | Inngest signing/event keys — set automatically by the Vercel integration |
| `NEXT_PUBLIC_SITE_URL` | no | base URL for invite links (defaults to `http://localhost:3000`) |
| `CREDENTIALS_ENCRYPTION_KEY` | for stored creds | hex key for AES-256-GCM encryption of integration credentials (`lib/crypto/credentials.ts`); mandatory once any generic integration saves a credential |
| `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET` | for Zoho OAuth | Zoho Invoice OAuth app (used only if an integration is created with type `zoho_invoice`) |
| `QUICKBOOKS_CLIENT_ID`, `QUICKBOOKS_CLIENT_SECRET` | for QuickBooks OAuth | QuickBooks OAuth app (integration type `quickbooks`). Other providers need their own `{ID,SECRET}` pair named in `lib/integrations/oauth-providers.ts` |

> Note: `NEXT_PUBLIC_` vars are exposed to the browser build; `SUPABASE_SERVICE_ROLE_KEY`
> must never appear in client code.

> Note: Inngest v4 has checkpointing enabled by default. `lib/clients/ingest.ts` is
> configured with `checkpointing.maxRuntime: "50s"`, so `/api/inngest` exports
> `maxDuration = 60` to stay within the runtime cap on serverless platforms.

---

## 4. Architecture — the message lifecycle

### Inbound (customer → agent)

```
Meta/Resend webhook ──▶ route handler (ACK < 5s, dedup check, enqueue only)
                            │
                            ▼
                Inngest: whatsapp/webhook.received | mail/webhook.received
                  (insert webhook_events, normalize to InboundMessage shape)
                            │ emit message/inbound
                            ▼
                Inngest: message/inbound  ← the orchestration function
                  resolve entitlements → hasTokenBudget() (hard/soft per plan)
                  → fall back to a budget-exhausted notice if over → else load
                  conversation + history, assign a fallback agent if the
                  conversation has none → run the LangGraph agent
(lib/agents/runtime.ts → graph.invoke, a state machine over
                  agent/tools/final nodes, see §5) → cost via calculateCost (provider.ts)
                  → persist messages + usage_events (with cost_usd) → bump
                    usage_counters (tokens_used + cost_usd) → emit message/outbound.send
                    → emit automation/triggered for every active after_agent_reply
                      automation (lib/automations/trigger.ts, fired from inside
                      message-inbound after the reply is persisted)
                            │
                            ▼
                  Inngest: outbound-message
                    channel adapter (WhatsApp template/text/flow) → Meta/Resend
```

### Outbound (dashboard/agent → customer)

Any outbound send enqueues `message/outbound.send` via
`lib/services/messages.ts` (`enqueueOutboundMessage`; `lib/services/wa-send.ts`
for the ad-hoc route path) or `lib/channels/` for the adapter path. The route
creates a `messages` row with status `queued` and returns immediately; the
Inngest function performs the actual Meta/Resend call and retries on failure.
Delivery callbacks (`sent/delivered/read/failed`) arrive on the WhatsApp status
webhook; `whatsapp-webhook-ingest` applies them inline to the `messages` row.
Bulk template campaigns enqueue `whatsapp/bulk.send`, which
`bulk-send-template` fans out into individual `message/outbound.send` events in
chunks of 5.

### Everything is durable

- Webhooks are ACKed immediately and deduplicated against `webhook_events`
  (unique `provider_event_id`) so Meta/Resend retries can't double-process.
- All sends are events, not awaits — a crash between "customer asked" and "we
  replied" results in a retry, never a lost message.

The full event catalog (names + payload schemas) lives in
`lib/inngest/events.ts` — **that file is the contract** between producers and
consumers. Add events there, not ad-hoc strings.

Inngest functions (all registered in `app/api/inngest/route.ts`):
`whatsapp-webhook-ingest`, `mail-webhook-ingest`, `message-inbound`,
`outbound-message`, `scheduled-message-runner`, `usage-reconcile`,
`kb-document-chunker` (kb/document.uploaded), `booking-reminder`
(booking/reminder.due), `flow-data-exchange` (flow/data.exchange),
`bulk-send-template` (whatsapp/bulk.send), `automation-run`
(automation/triggered — the durable executor of custom automations, see §4a).

### 4a. Custom automations

An automation is a pipeline of steps (`lib/automations/types.ts` Zod
schemas, stored in `automations.steps`) that fires on one of four triggers:

| Trigger | Emission point |
|---|---|
| `after_agent_reply` | `emitAfterAgentReply` — called from `message-inbound` in a step after the reply is persisted |
| `on_tool_call` | `emitOnToolCall` — called by `createAutomationToolNode` / `createHitlToolNode` after a tool executes, matched by `trigger_config.tool_name` |
| `ai_capture` | `lib/automations/capture-tool.ts` registers a LangGraph tool named `capture_<automationId>` on the agent (plus the dashboard AI-SDK loop via `buildAgentTools`); executing it emits `automation/triggered` with the captured fields as top-level `variables` |
| `manual` | fired on demand from a conversation (no emission helper yet) |

`lib/automations/trigger.ts` emits one `automation/triggered` event per
matching active automation; scoping is `agent_id null = all agents`, else the
exact agent. The durable function `automation-run`
(`lib/inngest/functions/automation-run.ts`) owns the run: it resolves context
(automation, contact, active WhatsApp account, last inbound user message),
creates an `automation_runs` row, executes each step in its own `step.run()`
(accumulating outputs as `variables["step_N"]`), honors `wait` steps via
`step.sleep()`, and mark-fails + rethrows on the first error.

Step executors (`lib/automations/executors.ts`) are one function per step
type — `api_call`, `send_message`, `send_template`, `send_document`,
`tag_contact`, `wait` — looked up from a dictionary (mirroring the tool
registry). Rules that matter:

- **`api_call`** resolves either an `integrationId` (a configured integration)
  or a raw `url`. Integration calls auto-attach `Authorization: Bearer` for
  OAuth-backed integrations (`getValidAccessToken`, which refreshes via the
  provider's tokenUrl when the access token is near expiry) and interpolate
  `{{integration.credential}}` in headers/url/body for generic integrations
  (`recursiveInterpolate`). **Request headers and decrypted credentials must
  never appear in `step_results`** — only response bodies do.
- Every string template is recursively interpolated from the run's `variables`
  (captured fields + prior step outputs) and contact metadata.
- `automation_runs.step_results` collects `{index,type,status,output,error}`
  for the run-history UI.

---

## 5. Agent state machine (LangGraph)

The customer-facing agent is a **LangGraph `StateGraph`**, not a hand-rolled
ReAct loop. It replaces the old `generateText`-in-a-while-loop runtime while
keeping Vercel AI SDK only for the dashboard chat streaming path (see
`tenant-runtime.ts`). Everything below lives in `lib/agents/`.

### 5.1 Where the pieces live

| File | Role |
|---|---|
| `provider.ts` | **Single source of truth** for models, pricing, provider routing (`ACTIVE_PROVIDER`, `MODELS`, `PRICING`), and SDK factories (`getAISDKModel`, `getLangChainModel`). Both the AI-SDK and LangGraph paths derive from here. |
| `runtime.ts` | Durable wrapper: builds the graph and invokes it inside **one** `step.run()`; extracts text / usage / diagnostics from the result via `graphMessageType`/`graphMessageContent`/`graphMessageUsage`. Exports `historyFromDb` to convert stored message rows into `ModelMessage[]`. |
| `graph/state.ts` | The `AgentState` schema (messages reducer, `iteration`, `metadata`). |
| `graph/nodes.ts` | `createAgentNode`, `createToolNode`, `createAutomationToolNode`, `createHitlToolNode`, `buildSystemPrompt`. System prompt includes a live datetime block and booking-specific instructions. Uses `getLangChainModel`. |
| `graph/edges.ts` | `shouldContinue`, `nextAfterTools`, `MAX_TOOL_ITERATIONS`. |
| `graph/tools.ts` | `buildLangChainTools(agentTools, ctx, agentId?)` — **async**, wraps the AI-SDK tool registry as LangChain `tool()` calls, then appends the tenant's active `ai_capture` capture tools. |
| `graph/graph.ts` | `buildAgentGraph` — the standard single-agent graph (async; wires `createAutomationToolNode`). |
| `graph/supervisor.ts` | `buildSupervisorGraph` — multi-agent supervisor routing (async). |
| `graph/hitl.ts` | Human-in-the-loop: `requiresApproval`, `storePendingAction`, `approve`/`reject`. |
| `tenant-runtime.ts` | **Dashboard chat path only** — `ToolLoopAgent` (AI SDK `ai` package) with `getAISDKModel`, not used by the inbound pipeline. |
| `tenant-tools.ts` | Dashboard-only tools: contact/business/service/resource/conversation read & CRUD, `list_bookings`, `bulk_send_template`, `create_template` (returns a `PENDING_PREVIEW` draft the UI must approve before submitting to Meta), `delete_template`, `list_kb_documents`, `get_usage_summary`. |

### 5.2 State

`AgentState` in `graph/state.ts` (from `@langchain/langgraph` `Annotation.Root`):

- **`messages: BaseMessage[]`** — accumulates via the reducer
  `(existing, update) => [...existing, ...update]` (appends new to old — note
  this is LangGraph's `(existing, update)` argument order, not the other way
  around).
- **`iteration: number`** — incremented each agent-node call; used to cap the
  tool loop.
- **`metadata`** — a plain object carrying `tenantId`, `conversationId`,
  `contactId`, `customerName`, `agentId`, `modelName`. **It is populated on
  every `invoke` in `runtime.ts`, never defaulted empty** — the HITL path reads
  these values to scope `agent_pending_actions` rows.

### 5.3 The standard graph (`buildAgentGraph`)

```
START → agent ──(shouldContinue)──▶ END
                 │ no tool_calls
                 ▼ (has tool_calls)
                tools ──(nextAfterTools)──▶ agent | final
                                              └─────▶ END (final)
```

- **`agent`** — calls `ChatGoogleGenerativeAI.bindTools(tools)` and returns one
  `AIMessage`. If a model is given `[]` tools (the `final` node), it is **not**
  bound to tools.
- **`tools`** — `createAutomationToolNode` (a wrapper around the prebuilt
  `ToolNode`): executes every tool call from the last AI message, emits
  `automation/triggered` via `emitOnToolCall` for matching `on_tool_call`
  automations, and returns `ToolMessage`s.
- **`shouldContinue`** — after `agent`: if the last message has `tool_calls`,
  go to `tools`; otherwise `END`.
- **`nextAfterTools`** — after `tools`: if `iteration >= MAX_TOOL_ITERATIONS`
  (6), go to the **`final`** node; else back to `agent`.
- **`final`** — a plain model call with no tools and an appended instruction to
  "give the customer a concise final response and do not call any tools." It
  exists so a conversation that exhausts its tool budget doesn't end mid-tool-
  call with an empty reply.

### 5.4 Supervisor graph (`buildSupervisorGraph`)

When `agent.type === "supervisor"`, `runtime.ts` builds a supervisor graph
instead. It reuses `AgentState` plus a `next` field. A lightweight classifier
node (`DEFAULT_MODEL`, temperature 0) labels the message
`faq | booking | template | escalation` and routes to the matching sub-agent.
Each sub-agent gets its own `{category}`, `{category}-tools`, and
`{category}-final` nodes wired with the same `shouldContinue`/`nextAfterTools`
edges. `ROUTE_MAP` in `supervisor.ts` defines each sub-agent's tools and
prompt; all sub-agents and the classifier now use `DEFAULT_MODEL` from
`provider.ts` (the classifier runs at temperature 0 — there is no longer a
per-route model override like the old `gemini-1.5-pro` booking model). Only
sub-agents whose tools are enabled for the tenant get nodes (empty ones are
skipped, and unknown classifier output falls back to `faq`).

### 5.5 `runDurableAgent` — the serialization-critical wrapper

`runtime.ts` builds **and** invokes the graph inside a single `step.run()`
(`"run-agent-graph"`). Do **not** split this into "build-graph" + "invoke-graph"
steps: a compiled graph contains methods and closures that Inngest cannot JSON-
serialize across a `step.run()` boundary, so the graph would come back from the
checkpoint as an inert object with no `invoke()`.

Graph builders are now **async** (`await buildAgentGraph(…)` /
`await buildSupervisorGraph(…)`) because tool construction hits the DB for
capture tools. `BuildGraphInput` carries `agentId` so `buildLangChainTools`
can append that agent's active `ai_capture` capture tools.

The second consequence of `step.run()` is that **LangChain message instances
are checkpointed as plain serialized JSON**, e.g.:

```json
{ "lc": 1, "type": "constructor",
  "id": ["langchain_core","messages","AIMessage"],
  "kwargs": { "content": "…", "tool_calls": […], "usage_metadata": {…} } }
```

So the post-step result is **not** a list of live `AIMessage` class instances.
`runtime.ts` uses three helpers to read it regardless of live-vs-checkpoint
form:
- `graphMessageType(msg)` → role string (`"ai"`, `"human"`, `"tool"`, …): checks
  live `_getType()`, then LangChain's serialized `id` last segment, then plain
  `type`.
- `graphMessageContent(msg)` → `content` or `kwargs.content`.
- `graphMessageUsage(msg)` → usage from `usage_metadata` / `response_metadata.usage`
  (live **and** `kwargs.*` forms).

`AgentRunResult` exposes the flattened output:

```
{ text, iterations, endedWithToolCall, finalMessageType,
  generatedAssistantMessages, lastToolResult?,
  usage: {inputTokens, outputTokens, totalTokens}, cost }
```

`message-inbound.ts` uses `text` for the reply (falling back to
`lastToolResult` — the most recent tool outcome, e.g. a failure detail — and
then to a canned "please give us a moment" reply), the usage fields for
metering, and the diagnostic fields (`endedWithToolCall`, `finalMessageType`,
`generatedAssistantMessages`) when it has to fall back.

### 5.6 Tool conversion — and the Gemini schema constraint

`buildLangChainTools` (`graph/tools.ts`) walks the existing AI-SDK catalog in
`lib/agents/registry.ts` and wraps each `def.execute` into a
`DynamicStructuredTool` with `schema: def.parameters`. **Tools stay defined once
in the AI-SDK format; `agent_tools` rows only toggle which get wrapped.**

It is now **async** and takes `agentId`. After wrapping the enabled registry
tools it appends `buildCaptureTools(tenantId, agentId)`
(`lib/automations/capture-tool.ts`): every active `ai_capture` automation whose
`agent_id` matches (or is null) becomes a LangGraph tool named
`capture_<automationId>` whose schema is derived from `trigger_config.fields`.
Executing one stores the captured values on the contact (per `saveToContact`)
and emits `automation/triggered` with those fields as top-level variables. The
dashboard AI-SDK chat path does the same in `buildAgentTools`
(`lib/agents/registry.ts`), so capture tools exist in both runtimes.

Gemini's function-calling schema has a constraint worth memorizing: it does not
understand the JSON-Schema `propertyNames` keyword, which Zod's `z.record()`
emits. A tool with a `z.record(...)` parameter fails at call time with
`Unknown name "propertyNames" …`. The workaround used in `trigger_flow` is to
accept the free-form map as a **JSON string** parameter and `JSON.parse` it
inside the tool. Prefer that pattern over `z.record`/`z.union` in tool schemas.

### 5.7 Human-in-the-loop (HITL)

Selective approval: only tools where `agent_tools.approval_required = true`
pause. `requiresApproval` (`graph/hitl.ts`) short-circuits to `false` for any
tool not in `HITL_CONTROLLED_TOOLS`
(`send_template`, `create_booking`, `cancel_booking`, `trigger_flow`,
`create_template`), then checks the tenant's `agent_tools` row.

`createHitlToolNode` intercepts tool calls: for an approval-required tool it
writes an `agent_pending_actions` row (status `pending`) and returns a
`ToolMessage` telling the agent the action is under human review; otherwise it
executes the tool inline (with try/catch so a thrown error becomes a recoverable
`ToolMessage` instead of crashing the node). The dashboard surfaces pending rows
via `components/pending-action-card.tsx`, and
`app/api/tenants/[tenantId]/agent/approve/route.ts` calls
`approvePendingAction` / `rejectPendingAction`.

> **Known gap:** today approval only flips the DB row to `approved`. Nothing yet
> executes the approved tool or automatically follows up with the customer, and
> the standard `buildAgentGraph` wires `createAutomationToolNode` (a plain
> `ToolNode` + `emitOnToolCall`) — not `createHitlToolNode` — so
> approval-based pausing is not on the active inbound path. See
> `docs/prompts/langgraph-integration.md` §3.1 for the two intended
> implementations (a follow-up Inngest function vs. real LangGraph
> `interrupt()`/`Command.resume()` with a persistent checkpointer).

The schema for this lives in `supabase/migrations/013_add_hitl.sql`
(`agent_pending_actions` table + `agent_tools.approval_required` column).

---

## 6. Auth & multi-tenancy — read this twice

Two distinct access layers:

1. **RLS (data layer)** — every tenant-scoped table is protected by policies
   keyed on `auth_tenant_ids()` (a `SECURITY DEFINER` function that reads
   `tenant_members`) or `is_god_user()` (checks `god_users` by email claim).
   See `supabase/migrations/001_initial-schema.sql` §8.
2. **Route guards (app layer)** — `lib/auth/guard.ts` uses the Supabase Auth
   session cookie:
   - `requireUser()` — any authenticated Supabase Auth user.
   - `requireGodUser()` — email must be in `god_users` (separate table, per
     guide §4 — never a JWT claim).
   - `requireTenantAccess(tenantId)` — user must be a row in `tenant_members`.

**Critical gotcha:** the admin client in `lib/clients/supabase.ts` uses the
service-role key and **bypasses RLS entirely**. Every service query MUST filter
by `tenant_id` explicitly. RLS is a backstop for client-side access; the service
layer is responsible for correct tenant scoping in every query.

### Tenancy model

- `tenants` — a customer. `god_users` manages who can administer the platform.
- `tenant_members` — which Supabase Auth user belongs to which tenant, with a
  role (`owner`/`admin`/`member`).
- `plans` — a named set of `limits` (the entitlement engine, see §7).
- `subscriptions` — a tenant's current plan. One active subscription per tenant
  (creating a new active one cancels the previous).

---

## 7. Entitlements & the `plans.limits` shape

`plans.limits` is JSONB and **is** the entitlement engine (guide §3). The
canonical shape is enforced by the Zod schema `planLimitsSchema` in
`lib/services/plans.ts`:

```json
{
  "max_agents": 1,
  "max_wa_accounts": 1,
  "allowed_agent_types": ["receptionist"],
  "allowed_channels": ["whatsapp"],
  "token_budget_monthly": 100000,
  "model_tier": "default",
  "enforcement": "hard"
}
```

Unknown keys are stripped on write. `resolveEntitlements(tenantId)` in
`lib/entitlements/resolve.ts` reads the active subscription → plan limits →
defaults, adds any `tenants.token_budget_topup` (set by god users) to the
monthly token budget, and returns a resolved `Entitlements` object. **Downstream
checks read that object, never `plans` directly.** The `hasTokenBudget()`
helper (same file) reads `usage_counters` against the resolved budget without
bumping any counters. If you add a limit key, update the Zod schema *and*
`DEFAULTS` in resolve.ts.

---

## 8. Conventions — follow these, or the code will fight you

1. **The Supabase client is untyped** (no generated `Database` type). A bare
   `.single()`/`.maybeSingle()` infers `data: never`. Always cast to an explicit
   row type — see any `lib/services/*.ts` (`data as TenantRow`). Never spread
   untyped rows around.
2. **Use `unwrap()`** (`lib/clients/supabase.ts`) to throw on error/null instead
   of hand-rolling `if (error)` checks.
3. **Errors flow through `lib/http.ts`**: throw `HttpError(status, msg)` in
   services; catch with `handleError(e)` in every route handler. It maps
   `ZodError` → 400 and unknown → 500.
4. **Next.js 16 route params are async.** Every handler is
   `async (request, { params }: { params: Promise<{ id: string }> })` and does
   `const { id } = await params`. Copy the pattern from an existing route.
5. **Tenant scoping is non-negotiable** in services (see §6).
6. **Message `content` shape** is standardized:
   `{ type: "text"|"template"|"flow"|"tool_call"|"tool_result", text?, meta? }`
   (Zod schema in `lib/inngest/events.ts`).
7. **Status strings are lowercase in the DB** (`'approved'`, `'active'`,
   `'queued'`). Compare against `String.prototype.toLowerCase()`-ed values;
   Meta's API uses uppercase (`APPROVED`) — convert at the boundary.
8. **Sends resolve accounts by either** DB `waAccountId` (uuid) **or** Meta
   `waPhoneNumberId` — never assume one.
9. **Guard every tenant/admin route at the top** of the handler; return
   `handleError(e)` on catch so `HttpError` statuses propagate.
10. **Don't add comments unless they explain *why*** (not what) — the codebase
    keeps them for schema shapes, FK ordering, and gotchas only.
11. **Cost calculation lives in `lib/agents/provider.ts`** — the `PRICING` map
    is defined there (Gemini + Groq, per-1M-token rates) and `calculateCost(model, inputTokens, outputTokens)`
    is re-exported via `lib/agents/pricing.ts`. Returns USD cost. Cost is stored
    in `usage_events.cost_usd` and `usage_counters.cost_usd`. The frontend reads
    it via the `/api/tenants/[tenantId]/usage` endpoint and formats it with
    `formatCurrency()` from `lib/format.ts`. *When adding or renaming models,
    update `MODELS` and `PRICING` in `provider.ts` (and the UI model dropdowns
    build from the same `MODELS` list).*
12. **Currency preference is per-tenant** — stored in `tenants.currency` (`'USD'` | `'INR'`). The `useCurrency()` hook reads from tenant context and persists via `PATCH /api/tenants/[tenantId]/currency`. The conversion rate is hardcoded in `lib/format.ts` (`CONVERSION_RATE_INR = 83.5`). All costs are stored in USD; conversion happens only at display time.
13. **Integration credentials are encrypted at rest** — `lib/crypto/credentials.ts` with AES-256-GCM (`CREDENTIALS_ENCRYPTION_KEY`, hex). Services store `new Uint8Array(0)` when no credential exists; `hasCredentials` is `byteLength >= 28`. Never store a plaintext credential.
14. **OAuth is one shared shape** — adding a provider means one entry in `lib/integrations/oauth-providers.ts` (two URLs, scopes, extra params, optional callback non-token field). `/oauth/start` mints a one-time `oauth_states` row, `/api/auth/oauth/callback` exchanges the code and stores tokens. Tokens auto-refresh via `getValidAccessToken`. Everything else (state table, encryption, refresh) never changes per provider.
15. **Automation steps must never leak secrets** — `step_results` stores response bodies only. Generic-integration credentials are exposed exclusively via `{{integration.credential}}` interpolation (never auto-injected as headers); OAuth integrations get an auto `Authorization: Bearer`. Capture tools are named `capture_<automationId>` to stay unique per automation.

---

## 9. Adding a new resource — the 4-step pattern

Say you're adding a `pricing_tiers` table:

1. **Schema** — new migration `supabase/migrations/00X_*.sql`: create table +
   RLS policies keyed on `tenant_id` (`auth_tenant_ids()` / `is_god_user()`,
   copy from an existing table's policy block).
2. **Service** — `lib/services/pricing-tiers.ts`: export a row interface, then
   `listX(tenantId)` / `getX(tenantId, id)` / `createX` / `updateX` / `deleteX`.
   Cast every response row, filter by `tenant_id` on every query, throw
   `HttpError` for conflicts.
3. **Route** — `app/api/admin/.../route.ts` (god-managed) or
   `app/api/tenants/[tenantId]/.../route.ts` (member-managed). Guard, parse JSON,
   call the service, wrap everything in `try/catch (e) { return handleError(e) }`.
4. **Docs** — add the endpoints to `docs/rest-api.md`.

---

## 10. Database

Full schema in `supabase/migrations/001_initial-schema.sql` (730 lines, sections
1–8) plus `002_support-whatsapp-flows.sql` (flows / flow_sessions /
campaign_schedules), `003_ingest_pipeline.sql` (scheduled messages + usage RPCs),
`004_agent_tool_seed.sql` (tool backfill for existing agents),
`005_tenant_owner_email.sql`, `006_wa_account_credentials.sql`,
`007_tenant_business_limit.sql` (per-tenant `max_businesses` cap),
`008_backfill_missing_agent_tools.sql` (cancel_booking, list_resources,
schedule_reminder), `009_backfill_template_and_datetime_tools.sql`
(create_template, get_current_datetime), `010_usage_events_cost_column.sql`
(cost_usd on usage_events), `011_tenants_currency.sql` (currency preference on
tenants), `012_tenant_chat_sessions.sql` (dashboard chat `chat_sessions` +
`chat_messages`), `013_add_hitl.sql` (HITL: `agent_tools.approval_required` +
`agent_pending_actions`), `014_fix_recompute_usage_cost.sql` (bugfix so
`recompute_usage_counters()` re-aggregates `cost_usd`, not just tokens),
`015_tenant_token_topup.sql` (`tenants.token_budget_topup` — god-user top-ups
that add to the plan's `token_budget_monthly`), `016_add_automations.sql`
(custom automations: `automations`, `automation_runs`, `integrations`),
and `017_add_oauth_states.sql` (single-use `oauth_states` rows for the
integration OAuth handshake).

Highlights:
- **Platform:** `god_users`, `tenants` (with `currency` preference,
  `max_businesses`, `token_budget_topup`), `tenant_members`, `plans`,
  `subscriptions`, `usage_counters` (period buckets with `tokens_used` +
  `cost_usd`), `usage_events` (per-call audit trail with `prompt_tokens`,
  `completion_tokens`, `total_tokens`, `cost_usd`, `model`).
- **Channels:** `wa_accounts`, `mail_accounts`, `whatsapp_templates`.
- **Conversations:** `contacts`, `conversations`, `messages`, `scheduled_messages`,
  `webhook_events` (idempotency), `chat_sessions` + `chat_messages` (dashboard chat).
- **Booking engine:** `businesses`, `resources`, `services`, `service_schemas`,
  `availability_rules`/`availability_exceptions`, `bookings`.
- **Automations:** `automations` (name, `agent_id`, `is_active`,
  `trigger_type` with check constraint incl. `ai_capture`, `trigger_config`
  JSONB, `steps` JSONB), `automation_runs` (status running/completed/failed,
  `step_results` JSONB), `integrations` (`type` incl. OAuth provider ids,
  `base_url`, `config`, AES-encrypted `credentials_encrypted` bytea),
  `oauth_states` (one-time handshake rows).
- **AI:** `agents`, `agent_tools` (incl. `approval_required`),
  `agent_pending_actions` (HITL queue), `agent_channels`,
  `knowledge_base_documents` + `knowledge_base_chunks` (pgvector).

**FK reality:** child tables have plain FKs (no `ON DELETE CASCADE`). Deletes
must happen deepest-first. `deleteTenant` (`lib/services/tenants.ts`) encodes
the correct ordering — `automation_runs` (via `automation_id`) before
conversations/contacts/automations, then `automations` (nullable `agent_id`,
deleted directly by tenant), `integrations`, and `oauth_states` — and
`deleteBusiness` (`lib/services/businesses.ts`) handles the business subtree.
If you add a table that references `tenants` or `businesses`, add it to those
delete lists.

---

## 11. Commands

```bash
npm run dev          # dev server
npm run build        # production build (Next requires all route handlers to compile)
npm run lint         # eslint — must be 0 errors before pushing
npx tsc --noEmit     # typecheck — run before lint; the client is untyped so most bugs surface here
```

There is no test suite yet. Typecheck + lint are the verification gate.

---

## 12. Things that will surprise you (learned the hard way)

- The DB stores lowercase statuses; Meta uses uppercase. Normalize at the
  boundary (`templates` sync and `outbound-message.ts` were both bitten by this).
- `subscriptions` allows multiple rows per tenant — "current plan" is always
  `status='active'` (see `resolveEntitlements`). Never assume one row.
- Route handlers run on the Node.js runtime; they must stay fast and only enqueue.
  Anything heavier belongs in an Inngest function.
- `@supabase/ssr` is used only for reading the session JWT in guards; route
  handlers can't write cookies, so the client's cookie `setAll` is a no-op.
- The `supabase/.temp/` directory is CLI state — it's gitignored, don't commit it.
- **Models, providers, and pricing all live in one file.** `lib/agents/provider.ts`
  (`ACTIVE_PROVIDER`, `MODELS`, `PRICING`, `getAISDKModel`, `getLangChainModel`)
  is the only place SDK classes are constructed and per-model costs are resolved.
  Don't build `ChatGoogleGenerativeAI`/`google()`/`createGroq()`/`ChatGroq`
  anywhere else — call the `get*Model` helpers so the UI dropdowns, costs, and
  runtime all stay consistent. `lib/agents/pricing.ts` only re-exports `provider.ts`.
- **The dashboard chat is not the inbox agent.** `tenant-runtime.ts` builds an
  AI-SDK `ToolLoopAgent` for the operator chat at `/api/tenants/[tenantId]/chat`;
  the inbound pipeline always uses `runDurableAgent`/LangGraph. Different models,
  different tools (`tenant-tools.ts`), different streaming path.

**LangGraph / Inngest (see §5 for detail):**
- **A compiled LangGraph graph can't cross a `step.run()` boundary.** Inngest
  serializes step output to JSON, destroying the graph's `invoke()` method. Build
  *and* invoke inside the **same** `step.run()` (as `runDurableAgent` does).
- **LangChain messages become serialized JSON after a `step.run()`.** Don't rely
  on `message instanceof AIMessage` — cross-boundary messages are
  `{ lc:1, type:"constructor", id:[...,"AIMessage"], kwargs:{…} }`. Use
  `graphMessageType`/`graphMessageContent`/`graphMessageUsage` in `runtime.ts`.
- **LangChain doesn't read `GOOGLE_GENERATIVE_AI_API_KEY` automatically.** Pass it
  explicitly as `apiKey` to every `ChatGoogleGenerativeAI` — via
  `getLangChainModel` in `provider.ts`, never inline in nodes/supervisor.
  `@ai-sdk/google` reads it automatically, which is why the old path worked.
  Same for Groq: `GROQ_API_KEY` is passed explicitly (only to Groq models).
- **Inngest v4 checkpointing is on by default.** `lib/clients/ingest.ts` sets
  `checkpointing.maxRuntime: "50s"` and `/api/inngest` exports `maxDuration = 60`.
  If you raise the runtime cap, keep the two in sync. Step output is still
  JSON-serialized regardless — checkpointing doesn't change the
  LangGraph/message caveats above.
- **Gemini tool schemas reject `propertyNames`.** Avoid `z.record()` in tool
  parameters — it makes Gemini error with
  `Unknown name "propertyNames"`. Pass free-form maps as JSON strings instead
  (see `trigger_flow.data`).
- **A run that ends on an AI *tool-call* message yields empty `text`.** The graph's
  `final` node exists precisely to force a tool-free closing reply once the tool
  budget is spent — don't remove it, or conversations will "hang" with no reply.

**Custom automations & integrations:**
- **`agent_id null` on an automation means "all agents".** `listActiveAutomationsForTrigger`
  treats null as a wildcard and scopes by `agent_id` only when a specific agent is given.
- **Inngest v4 forbids `.default()` in event schemas.** `automationTriggered.variables` is
  required (`z.record(z.string(), z.unknown())`) — every emitter passes `variables` explicitly.
- **One tools builder serves both runtimes.** `buildLangChainTools` (LangGraph) and
  `buildAgentTools` (dashboard AI-SDK) both append capture tools, so an `ai_capture`
  automation's fields work identically in the inbound pipeline and operator chat.
- **`step.sleep(id, duration)` takes no type args** in Inngest v4; the automation `wait`
  step passes a `"seconds"` string and accumulates prior outputs via `step.run` variables.
- **OAuth providers are decrypting speed-bumps, not snowflakes.** The refresh is always
  `grant_type=refresh_token` against the provider's `tokenUrl`; a non-OAuth integration
  type hits `getValidAccessToken` only if you forgot the `isOAuthProviderType` guard.
- **The OAuth callback redirects to a dashboard page**, never returns JSON:
  `/dashboard/oauth-result?from=integration&success=1|0&name=&tenantId=` — keep that
  page (and its `Suspense` wrapper, since it reads `useSearchParams`).
