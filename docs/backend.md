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
(`@langchain/langgraph`, `@langchain/core`, `@langchain/google-genai`) driving
the agent state machine, with Vercel AI SDK (`ai@7`, `@ai-sdk/google`) retained
for the dashboard chat streaming path · Inngest (durable event pipeline /
background jobs) · Meta Cloud API (WhatsApp) · Resend (mail).

**Stack truth that matters:** this is a **jobs/event-driven backend wearing a
Next.js coat**. Route handlers are thin HTTP fronts — the real work happens in
Inngest functions. Never put LLM calls, Meta calls, or long-running work inline
in a route handler. The inbound agent reply is a LangGraph state machine (see
§5) driven from inside the durable `message-inbound` Inngest function.

---

## 2. Repo layout

```
app/api/                     route handlers only (thin)
  auth/callback/             Supabase OAuth callback
  me/                        current-user endpoint
  admin/                     god-mode CRUD: tenants, plans, subscriptions, god-users
  tenants/[tenantId]/        tenant-scoped CRUD (see below)
  whatsapp/                  webhooks, flows, message send-* / services, templates
  mail/webhooks/             Resend inbound
  inngest/                   Inngest SDK serving endpoint

app/privacy/                 public privacy page (not an API route)

lib/
  api/                       shared API client + types
  clients/supabase.ts        untyped admin (service-role) client + unwrap()
  clients/ingest.ts          Inngest client
  supabase/browser.ts        browser Supabase client
  auth/guard.ts              session guards: requireUser / requireGodUser / requireTenantAccess
  http.ts                    HttpError + response/error helpers used by every route
  services/                  data-access layer — one file per aggregate (tenants, plans, bookings, …)
  agents/                    agent logic: runtime.ts (durable LangGraph wrapper), graph/ (the state machine, see §5),
                             registry.ts (tool catalog), tenant-runtime.ts + tenant-tools.ts (dashboard AI-SDK streaming),
                             errors.ts, pricing.ts (cost calculator), date-validation.ts
  agents/graph/              LangGraph: state.ts, nodes.ts, edges.ts, graph.ts, supervisor.ts, tools.ts, hitl.ts, index.ts
  channels/                  ChannelAdapter interface + registry + whatsapp/mail adapters
  crypto/whatsapp-crypto.ts  WhatsApp Flow payload decryption
  entitlements/resolve.ts    plan limits → Entitlements resolution
  inngest/functions/         every background function
  inngest/events.ts          the typed event catalog (source of truth for event shapes)
  meta/whatsapp.ts           Meta Graph API calls (templates, send)
  format.ts                  formatCurrency (USD/INR) with Intl.NumberFormat

hooks/
  use-currency.ts            client-side currency hook (syncs with tenant DB preference)

supabase/migrations/         SQL migrations, applied in order
docs/                        guide, rest-api reference, api-guide, llms/, this file
```

**Tenant-scoped routes** (`app/api/tenants/[tenantId]/`):

```
agents/                      appointment-services/    availability-rules/
bookings/                    businesses/              contacts/
contacts/[contactId]/        conversations/           currency/
entitlements/                kb-documents/            mail-accounts/
members/                     resources/               templates/
usage/                       wa-accounts/
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
| `GOOGLE_GENERATIVE_AI_API_KEY` | yes | Google Gemini via `@ai-sdk/google` *and* LangChain's `ChatGoogleGenerativeAI`. Note: `@ai-sdk/google` reads this env var automatically, but LangChain does **not** — it is passed explicitly via the `apiKey` field in `lib/agents/graph/nodes.ts` and `lib/agents/graph/supervisor.ts`. |
| `WHATSAPP_VERIFY_TOKEN` | for WA | webhook GET verification |
| `META_APP_SECRET` | for WA | webhook signature validation |
| `WHATSAPP_API_KEY` | for WA | Meta Graph API bearer token |
| `FLOW_PRIVATE_KEY_PEM`, `FLOW_PRIVATE_KEY_PASSPHRASE` | for flows | WhatsApp Flow payload decryption |
| `RESEND_API_KEY` | for mail | Resend adapter |
| `AI_MODEL` | no | default agent model (defaults in `lib/agents/runtime.ts`) |
| `INNGEST_DEV` | dev | set to `"1"` to route Inngest calls to the local dev server |
| `NEXT_PUBLIC_SITE_URL` | no | base URL for invite links (defaults to `http://localhost:3000`) |

> Note: `NEXT_PUBLIC_` vars are exposed to the browser build; `SUPABASE_SERVICE_ROLE_KEY`
> must never appear in client code.

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
                  resolve tenant + agent + entitlements → run the LangGraph agent
                  (lib/agents/runtime.ts → graph.invoke, a state machine over
                  agent/tools/final nodes, see §5) → calculate cost via pricing.ts
                  (tokens × model rate) → persist messages + usage_events (with
                  cost_usd) → bump usage_counters (tokens_used + cost_usd) →
                  emit message/outbound.send
                            │
                            ▼
                Inngest: outbound-message
                  channel adapter (WhatsApp template/text) → Meta/Resend
```

### Outbound (dashboard/agent → customer)

Any outbound send enqueues `message/outbound.send` via
`lib/services/wa-send.ts` (or `lib/channels/` for the adapter path). The route
creates a `messages` row with status `queued` and returns immediately; the
Inngest function performs the actual Meta/Resend call and retries on failure.
Delivery callbacks (`sent/delivered/read/failed`) arrive on the WhatsApp status
webhook and update the row.

### Everything is durable

- Webhooks are ACKed immediately and deduplicated against `webhook_events`
  (unique `provider_event_id`) so Meta/Resend retries can't double-process.
- All sends are events, not awaits — a crash between "customer asked" and "we
  replied" results in a retry, never a lost message.

The full event catalog (names + payload schemas) lives in
`lib/inngest/events.ts` — **that file is the contract** between producers and
consumers. Add events there, not ad-hoc strings.

Inngest functions: `whatsapp-webhook-received`, `mail-webhook-received`,
`message-inbound`, `outbound-message`, `scheduled-message-runner`,
`usage-reconcile`, `kb-chunk` (kb/document.uploaded), `booking-reminder`
(booking/reminder.due), `flow-data-exchange` (flow/data.exchange).

---

## 5. Agent state machine (LangGraph)

The customer-facing agent is a **LangGraph `StateGraph`**, not a hand-rolled
ReAct loop. It replaces the old `generateText`-in-a-while-loop runtime while
keeping Vercel AI SDK only for the dashboard chat streaming path (see
`tenant-runtime.ts`). Everything below lives in `lib/agents/`.

### 5.1 Where the pieces live

| File | Role |
|---|---|
| `runtime.ts` | Durable wrapper: builds the graph and invokes it inside **one** `step.run()`; extracts text / usage / diagnostics from the result. |
| `graph/state.ts` | The `AgentState` schema (messages reducer, `iteration`, `metadata`). |
| `graph/nodes.ts` | `createAgentNode`, `createToolNode`, `createHitlToolNode`, `buildSystemPrompt`. |
| `graph/edges.ts` | `shouldContinue`, `nextAfterTools`, `MAX_TOOL_ITERATIONS`. |
| `graph/tools.ts` | `buildLangChainTools` — wraps the AI-SDK tool registry as LangChain tools. |
| `graph/graph.ts` | `buildAgentGraph` — the standard single-agent graph. |
| `graph/supervisor.ts` | `buildSupervisorGraph` — multi-agent supervisor routing. |
| `graph/hitl.ts` | Human-in-the-loop: `requiresApproval`, `storePendingAction`, `approve`/`reject`. |
| `tenant-runtime.ts` / `tenant-tools.ts` | **Unchanged** AI-SDK `streamText` path used by the dashboard chat (`lib/agents/tenant-runtime.ts`), not by the inbound pipeline. |

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
- **`tools`** — the prebuilt `ToolNode`, executes every tool call from the last
  AI message and returns `ToolMessage`s.
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
node (`gemini-3.1-flash-lite`, temperature 0) labels the message
`faq | booking | template | escalation` and routes to the matching sub-agent.
Each sub-agent gets its own `{category}`, `{category}-tools`, and
`{category}-final` nodes wired with the same `shouldContinue`/`nextAfterTools`
edges. `ROUTE_MAP` in `supervisor.ts` defines each sub-agent's tools, prompt,
and model (booking uses `gemini-1.5-pro`; the rest `gemini-3.1-flash-lite`).
Only sub-agents whose tools are enabled for the tenant get nodes (empty ones are
skipped, and unknown classifier output falls back to `faq`).

### 5.5 `runDurableAgent` — the serialization-critical wrapper

`runtime.ts` builds **and** invokes the graph inside a single `step.run()`
(`"run-agent-graph"`). Do **not** split this into "build-graph" + "invoke-graph"
steps: a compiled graph contains methods and closures that Inngest cannot JSON-
serialize across a `step.run()` boundary, so the graph would come back from the
checkpoint as an inert object with no `invoke()`.

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
  generatedAssistantMessages, usage: {inputTokens, outputTokens, totalTokens}, cost }
```

`message-inbound.ts` uses `text` for the reply, the usage fields for metering,
and the diagnostic fields (`endedWithToolCall`, `finalMessageType`,
`generatedAssistantMessages`) when it has to fall back to a canned "please give
us a moment" reply on empty output.

### 5.6 Tool conversion — and the Gemini schema constraint

`buildLangChainTools` (`graph/tools.ts`) walks the existing AI-SDK catalog in
`lib/agents/registry.ts` and wraps each `def.execute` into a
`DynamicStructuredTool` with `schema: def.parameters`. **Tools stay defined once
in the AI-SDK format; `agent_tools` rows only toggle which get wrapped.**

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
> the standard `buildAgentGraph` still wires `createToolNode` (not
> `createHitlToolNode`), so approval-based pausing is not on the active inbound
> path. See `docs/prompts/langgraph-integration.md` §3.1 for the two intended
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
defaults and returns a resolved `Entitlements` object. **Downstream checks read
that object, never `plans` directly.** If you add a limit key, update the Zod
schema *and* `DEFAULTS` in resolve.ts.

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
11. **Cost calculation lives in `lib/agents/pricing.ts`** — `calculateCost(model, inputTokens, outputTokens)` returns USD cost. The pricing map covers all current Gemini models (Aug 2026 rates). When adding new models, update the `PRICING` map. Cost is stored in `usage_events.cost_usd` and `usage_counters.cost_usd`. The frontend reads it via the `/api/tenants/[tenantId]/usage` endpoint and formats it with `formatCurrency()` from `lib/format.ts`.
12. **Currency preference is per-tenant** — stored in `tenants.currency` (`'USD'` | `'INR'`). The `useCurrency()` hook reads from tenant context and persists via `PATCH /api/tenants/[tenantId]/currency`. The conversion rate is hardcoded in `lib/format.ts` (`CONVERSION_RATE_INR = 83.5`). All costs are stored in USD; conversion happens only at display time.

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
`007_max_businesses.sql`, `008_backfill_missing_agent_tools.sql`
(cancel_booking, list_resources, schedule_reminder),
`009_backfill_template_and_datetime_tools.sql` (create_template,
get_current_datetime), `010_usage_events_cost_column.sql` (cost_usd on
usage_events), `011_tenants_currency.sql` (currency preference on tenants),
`012_tenant_chat_sessions.sql` (dashboard chat `chat_sessions`), and
`013_add_hitl.sql` (HITL: `agent_tools.approval_required` +
`agent_pending_actions`).

Highlights:
- **Platform:** `god_users`, `tenants` (with `currency` preference), `tenant_members`, `plans`,
  `subscriptions`, `usage_counters` (period buckets with `tokens_used` + `cost_usd`),
  `usage_events` (per-call audit trail with `prompt_tokens`, `completion_tokens`,
  `total_tokens`, `cost_usd`, `model`).
- **Channels:** `wa_accounts`, `mail_accounts`, `whatsapp_templates`.
- **Conversations:** `contacts`, `conversations`, `messages`, `scheduled_messages`,
  `webhook_events` (idempotency), `chat_sessions` (dashboard chat).
- **Booking engine:** `businesses`, `resources`, `services`, `service_schemas`,
  `availability_rules`/`availability_exceptions`, `bookings`.
- **AI:** `agents`, `agent_tools` (incl. `approval_required`),
  `agent_pending_actions` (HITL queue), `agent_channels`,
  `knowledge_base_documents` + `knowledge_base_chunks` (pgvector).

**FK reality:** child tables have plain FKs (no `ON DELETE CASCADE`). Deletes
must happen deepest-first. `deleteTenant` (`lib/services/tenants.ts`) and
`deleteBusiness` (`lib/services/businesses.ts`) encode the correct ordering —
if you add a table that references `tenants` or `businesses`, add it to those
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

**LangGraph / Inngest (see §5 for detail):**
- **A compiled LangGraph graph can't cross a `step.run()` boundary.** Inngest
  serializes step output to JSON, destroying the graph's `invoke()` method. Build
  *and* invoke inside the **same** `step.run()` (as `runDurableAgent` does).
- **LangChain messages become serialized JSON after a `step.run()`.** Don't rely
  on `message instanceof AIMessage` — cross-boundary messages are
  `{ lc:1, type:"constructor", id:[...,"AIMessage"], kwargs:{…} }`. Use
  `graphMessageType`/`graphMessageContent`/`graphMessageUsage` in `runtime.ts`.
- **LangChain doesn't read `GOOGLE_GENERATIVE_AI_API_KEY` automatically.** Pass it
  explicitly as `apiKey` to every `ChatGoogleGenerativeAI` (nodes.ts, supervisor.ts);
  `@ai-sdk/google` does read it automatically, which is why the old path worked.
- **Gemini tool schemas reject `propertyNames`.** Avoid `z.record()` in tool
  parameters — it makes Gemini error with
  `Unknown name "propertyNames"`. Pass free-form maps as JSON strings instead
  (see `trigger_flow.data`).
- **A run that ends on an AI *tool-call* message yields empty `text`.** The graph's
  `final` node exists precisely to force a tool-free closing reply once the tool
  budget is spent — don't remove it, or conversations will "hang" with no reply.
