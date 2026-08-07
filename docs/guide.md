# WA Agent Platform — Architecture & MVP Roadmap
 
**Stack:** Next.js 16.2 (App Router) · Supabase (Auth/DB/Storage) · AI SDK (Vercel) · Inngest (events/scheduling) · Meta Cloud API (WhatsApp) · Resend (Mail)
 
**Goal of this doc:** a plan you can actually build against — MVP first, but structured so nothing has to be rewritten when you add tenants, channels, agent types, or plans later.
 
---
 
## 1. Guiding Principles
 
1. **Everything is config, not code.** Agent behavior, plan limits, channel bindings — all live in JSONB/tables, not in `if` statements. Adding a new agent type or plan should never require a deploy of new business logic paths, only new config rows + (at most) a new prompt/tool set.
2. **Channels are adapters, not branches.** WhatsApp and Mail are two implementations of the same `Channel` interface (`send`, `receive`, `normalizeInbound`). Adding SMS/Instagram later = one new adapter, zero changes to agent/orchestration code.
3. **One inbound pipeline.** Every inbound message (WhatsApp webhook, mail webhook) is normalized into a single internal event shape as early as possible, and everything downstream (agent routing, usage tracking, storage) is channel-agnostic.
4. **Durability over cleverness.** Webhooks must ACK in <5s (Meta will retry/disable otherwise). All actual work — LLM calls, tool calls, sending replies — happens in Inngest functions, not inline in the webhook handler.
5. **Tenant isolation is enforced at the data layer**, not just the app layer (Supabase RLS on every tenant-scoped table), so a bug in application code can't leak cross-tenant data.
6. **Plan = entitlements**, resolved once per request/job into a small object (`{ maxAgents, allowedAgentTypes, allowedChannels, tokenBudget, model }`) rather than scattered `if (plan === 'pro')` checks.
 
---
 
## 2. High-Level Architecture
 
```
                        ┌─────────────────────────┐
 WhatsApp Cloud API ───▶│ /api/whatsapp/webhooks  │──┐
                        └─────────────────────────┘  │
                                                       │ (fast ACK, enqueue only)
 Resend inbound ───────▶│ /api/mail/webhooks      │──┤
                        └─────────────────────────┘  │
                                                       ▼
                                            ┌────────────────────┐
                                            │  Inngest: ingest    │  (idempotency check,
                                            │  event function     │   normalize → InboundMessage)
                                            └─────────┬──────────┘
                                                       ▼
                                            ┌────────────────────┐
                                            │ Inngest: agent      │  (load tenant/agent config,
                                            │ orchestration fn    │   entitlement check, run agent)
                                            └─────────┬──────────┘
                                                       ▼
                                     ┌────────────────────────────────┐
                                     │  Agent Runtime (AI SDK)         │
                                     │  - LangGraph/state-machine core │
                                     │  - tool calls (KB search,       │
                                     │    booking, escalate, etc.)     │
                                     └─────────┬───────────────────────┘
                                               ▼
                                     ┌────────────────────┐
                                     │ Channel Adapter     │  (WhatsApp send-text/util/flow,
                                     │ (send reply)        │   or Resend send)
                                     └────────────────────┘
                                               ▼
                                     usage_events + messages persisted,
                                     usage_counters incremented (Inngest
                                     step, not a DB trigger, so it's
                                     retried/idempotent too)
```
 
Everything left of "Agent Runtime" is channel-specific and thin. Everything from "Agent Runtime" onward is channel-agnostic.
 
---
 
## 3. Domain Model — Notes on the Current Schema
 
Your schema is a solid start. Additions/adjustments worth making before or shortly after MVP:
 
| Area | Suggestion | Why |
|---|---|---|
| `agents` | Add `plan_tier_required text[]` or resolve via `plans.limits.allowed_agent_types` | Lets you gate which agent types a tenant can enable without a new column per plan |
| `messages.content` | Standardize a shape: `{ type: 'text'|'template'|'flow'|'tool_call'|'tool_result', text?, meta? }` | Keeps rendering/analytics simple across channels |
| `conversations` | Add `last_message_at`, `unread_count` (denormalized) | Inbox UI will need cheap sorting/filtering, don't compute on the fly at scale |
| **New:** `webhook_events` | `id, tenant_id, channel, provider_event_id unique, payload jsonb, status, created_at` | Idempotency — Meta/Resend both retry webhooks; without a dedup table you'll double-process |
| **New:** `agent_tools` or `tool_registry` | `agent_id, tool_name, config jsonb, enabled` | Lets you turn tools (booking, KB search, escalate-to-human) on/off per agent without redeploying |
| **New:** `bookings` (once appointment agent ships) | `tenant_id, contact_id, agent_id, starts_at, ends_at, status, metadata` | Appointment agent needs a first-class object, not something buried in `messages` |
| **New:** `whatsapp_templates` | `tenant_id, wa_account_id, name, category, language, status, components jsonb, meta_template_id` | `/api/templates` needs a source of truth distinct from Meta's API, for caching + approval-status tracking |
| `plans.limits` shape | Standardize keys now: `{ max_agents, max_wa_accounts, allowed_agent_types[], allowed_channels[], token_budget_monthly, model_tier }` | This JSONB *is* your entitlement engine — get the shape right early |
| RLS | Every tenant-scoped table needs an RLS policy keyed on `tenant_id = auth.jwt() -> tenant_id` (or a `tenant_members` join table) | Non-negotiable for multi-tenant Supabase; retrofit is painful |
 
**One structural decision to make now:** add a `tenant_members` table (`user_id, tenant_id, role`) rather than assuming one Supabase user = one tenant. Even for MVP, you'll likely want a client to invite a teammate, and retrofitting this later touches every RLS policy.
 
---
 
## 4. Multi-Tenancy & Entitlements
 
- **Auth:** Supabase Auth for tenant users; `god_users` stays a fully separate table/role (not a Supabase Auth role flag) so an application-level bug can't accidentally grant god access via a spoofed claim.
- **Entitlement resolution:** one function, `resolveEntitlements(tenantId)`, called at the top of the orchestration Inngest function and cached (short TTL, e.g. Supabase Realtime or just re-fetch per job — don't over-engineer caching for MVP). Returns the shape from the table above. Every downstream check (`canUseAgentType`, `hasTokenBudget`, `canAddWaAccount`) reads from this object, never from `plans` directly.
- **Usage enforcement:** `usage_counters` is checked *before* the LLM call (estimate) and reconciled *after* (actual tokens from AI SDK response). Hard-stop vs soft-warn behavior should itself be a plan setting (`limits.enforcement: 'hard' | 'soft'`), not hardcoded — you will want soft limits for trial tenants and hard limits for pay-as-you-go abuse prevention.
 
---
 
## 5. Agent Architecture
 
- **Runtime:** AI SDK for the actual model calls (streaming, tool calling, structured output); a lightweight state machine (or LangGraph if you want portability across providers/checkpointing) on top for agents with clear multi-step flows (booking: collect→confirm→book vs. open-ended receptionist chat).
- **Config-driven, not type-driven:** `agents.type` picks a *template* (receptionist, appointments, sales), but the actual system prompt, tools, and model come from `agents.instructions` + `agents.model_config` + `agent_tools`. This means launching "agent type #4" for a new vertical is a data-entry task, not a code change, as long as it composes existing tools.
- **Tool interface:** define tools once (`searchKnowledgeBase`, `createBooking`, `escalateToHuman`, `sendTemplate`) as AI SDK tools with Zod schemas. `agent_tools` just toggles which are exposed to which agent — this is your extensibility lever for the next 12 months.
- **Escalation/handoff:** build a `escalate_to_human` tool from day one even if MVP just flips `conversations.status = 'needs_human'` — clients will ask for this in week two.
 
---
 
## 6. Channel Layer
 
Define a single interface, implemented per channel:
 
```ts
interface ChannelAdapter {
  sendText(to: string, text: string, ctx: TenantChannelCtx): Promise<SendResult>
  sendTemplate?(to: string, template: TemplateRef, ctx): Promise<SendResult>   // WA only
  triggerFlow?(to: string, flow: FlowRef, ctx): Promise<SendResult>            // WA only
  normalizeInbound(rawPayload: unknown): InboundMessage                       // both
}
```
 
- `whatsappAdapter` wraps your existing `/api/whatsapp/send-text`, utility/service message logic, and `/api/whatsapp/flows` trigger.
- `mailAdapter` wraps Resend send + inbound parsing.
- Orchestration code calls `getAdapter(conversation.channel)` and never imports `whatsapp*` or `mail*` code directly. This is the single biggest thing that keeps a 3rd channel (Instagram DM, SMS) a small addition instead of a rewrite.
 
### WhatsApp routes — current + how they fit in
 
| Route | Role |
|---|---|
| `/api/whatsapp/webhooks` | Verify + fast-ACK + enqueue raw payload to Inngest (dedup via `webhook_events`) |
| `/api/templates` | CRUD against `whatsapp_templates` + proxy to Meta's template API; source of truth for approval status |
| `/api/whatsapp/send-text` | Thin wrapper the adapter calls; also directly reusable for manual/agent-triggered sends |
| utility message service | Same pattern — used for session-window-expired notifications, cost-tier-aware sends |
| flow trigger | Used both by agents (tool call) and manually (dashboard action) — keep it a standalone callable, not buried inside the webhook handler |
 
---
 
## 7. Inngest Usage
 
Three function families cover MVP:
 
1. **`whatsapp/webhook.received`** and **`mail/webhook.received`** — dedup (via `webhook_events.provider_event_id`), normalize, emit `message.inbound`.
2. **`message.inbound`** — the orchestration function: resolve tenant/agent/entitlements → run agent → send reply via adapter → persist `messages`/`usage_events` → increment `usage_counters`.
3. **`usage.reconcile`** (cron, e.g. hourly) — recompute `usage_counters` from `usage_events` to self-heal any drift from step failures. Cheap insurance.
 
Later additions slot into the same pattern with no restructuring: `booking.reminder` (scheduled send), `plan.downgrade.enforce`, `kb.reindex`.
 
---
 
## 8. Knowledge Base / RAG
 
MVP: `knowledge_base_documents` → chunk → embed → `knowledge_base_chunks` (pgvector via Supabase). A single `searchKnowledgeBase` tool does a similarity query scoped to `tenant_id`. Don't build a fancy ingestion pipeline yet — a Supabase Storage upload + one Inngest function (`kb.document.uploaded` → chunk → embed → store) is enough, and it's already the right shape for later (swap chunking strategy, add reranking, add per-agent KB scoping) without touching callers.
 
---
 
## 9. MVP Scope (Phase 1 — get to first paying clients)
 
**Ship:**
- Tenant + plan + subscription (manual creation via god-mode admin is fine — no self-serve billing yet)
- One channel fully working: **WhatsApp** (mail can lag)
- One agent type polished: **receptionist** (FAQ + KB search + escalate-to-human); appointments agent can be a v1.1 if time-boxed
- Webhook → Inngest → agent → reply pipeline, with idempotency
- Basic dashboard: conversations inbox, KB document upload, agent instruction editor, usage view
- Manual template management via `/api/templates` (approval status shown, not auto-submitted flows yet)
 
**Explicitly defer:**
- Self-serve signup/billing (Stripe/Razorpay) — god-mode admin creates tenants manually for first clients
- Mail channel polish (build the adapter interface now, flesh out later)
- Multi-agent-per-conversation routing (rules for “when does sales agent take over from receptionist”)
- Fine-grained per-agent-per-tool cost accounting (`usage_events.model` is enough for MVP-level billing conversations)
- Analytics/reporting dashboard beyond raw counts
 
This scope lets you sign clients on the receptionist use case while the architecture already has the seams (channel interface, tool registry, entitlements table) to add appointments, sales agents, and mail without rework.
 
---
 
## 10. Phase 2 (post first clients)
 
- Self-serve onboarding + Stripe/Razorpay billing → writes `subscriptions`/`plans` rows the same way god-mode does today (no parallel code path)
- Appointments agent fully productionized with `bookings` table + calendar sync (Google/Outlook) as a new tool
- Mail channel live, using the same adapter interface
- Multi-agent routing within a conversation (a lightweight "router" step before the main agent, itself just another agent config)
- WhatsApp Flows for structured data collection (booking forms, feedback)
- Per-tenant custom domains/branding on the dashboard if you're selling white-label
 
## 11. Phase 3 (scale)
 
- Move heavy KB reindexing / bulk exports to background workers outside Inngest's request-scoped model if volume demands it
- Sharding or read-replicas if a single Supabase project becomes the bottleneck (tenant data is already isolated enough to shard by `tenant_id` range if needed)
- Formal admin/ops tooling for god-mode users (impersonation, per-tenant kill switch, plan override audit log)
- SLA-grade retry/alerting on Inngest functions (dead-letter queue → Slack/PagerDuty)
 
---
 
## 12. Suggested Folder Structure
 
```
/app
  /api
    /whatsapp/webhooks/route.ts
    /whatsapp/send-text/route.ts
    /whatsapp/flows/route.ts
    /mail/webhooks/route.ts
    /templates/route.ts
  /(dashboard)/... 
/lib
  /channels
    channel.interface.ts
    whatsapp.adapter.ts
    mail.adapter.ts
  /agents
    runtime.ts          // AI SDK + state machine glue
    tools/
      search-kb.ts
      create-booking.ts
      escalate.ts
  /entitlements
    resolve.ts
  /inngest
    functions/
      webhook-received.ts
      message-inbound.ts
      usage-reconcile.ts
/supabase
  /migrations
```
 
This mirrors the architecture 1:1 — a new dev (or future you) can find "where does WhatsApp-specific logic live" and "where does agent-agnostic logic live" without guessing.
 
---
 
## 13. Key Risks to Design Around Now
 
- **Webhook idempotency** — Meta *will* redeliver. `webhook_events` unique constraint on provider event id is cheap insurance against double replies to a customer.
- **RLS retrofits are painful** — write policies as you create tables, not after.
- **JSONB config drift** — pick the `plans.limits` and `agents.model_config` shapes deliberately now; document them in code (Zod schemas) so "what keys exist" isn't tribal knowledge.
- **Session-window costs (WhatsApp)** — utility vs. service message pricing differs; the adapter should decide message type based on last-inbound timestamp, not leave it to caller judgment.