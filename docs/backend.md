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
(Auth/Postgres/RLS) · Vercel AI SDK (`ai@7`) + Google Gemini · Inngest
(durable event pipeline / background jobs) · Meta Cloud API (WhatsApp) · Resend
(mail).

**Stack truth that matters:** this is a **jobs/event-driven backend wearing a
Next.js coat**. Route handlers are thin HTTP fronts — the real work happens in
Inngest functions. Never put LLM calls, Meta calls, or long-running work inline
in a route handler.

---

## 2. Repo layout

```
app/api/                     route handlers only (thin)
  admin/                     god-mode CRUD: tenants, plans, subscriptions, god-users, members
  tenants/[tenantId]/        tenant-scoped CRUD: businesses, wa_accounts, mail_accounts
  whatsapp/                  webhooks, flows, message send-* / services, templates
  mail/webhooks/             Resend inbound
  ingest/                    Inngest SDK serving endpoint
  privacy/                   public page

lib/
  clients/supabase.ts        untyped admin (service-role) client + unwrap()
  clients/ingest.ts          Inngest client
  auth/guard.ts              session guards: requireUser / requireGodUser / requireTenantAccess
  http.ts                    HttpError + response/error helpers used by every route
  services/                  data-access layer — one file per aggregate (tenants, plans, bookings, …)
  agents/                    AI SDK glue: runtime.ts (generateText), registry.ts (tool catalog)
  channels/                  ChannelAdapter interface + whatsapp/mail adapters
  entitlements/resolve.ts    plan limits → Entitlements resolution
  inngest/functions/         every background function
  inngest/events.ts          the typed event catalog (source of truth for event shapes)
  meta/whatsapp.ts           Meta Graph API calls (templates, send)

supabase/migrations/         SQL migrations, applied in order
docs/                        guide, rest-api reference, this file
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
# in a second shell, run Inngest locally and point it at /api/ingest:
npx inngest-cli dev    # expects INNGEST_DEV=true and the URL /api/ingest
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
| `NEXT_PUBLIC_SUPABASE_URL` | yes | admin client + auth guard |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | yes | auth guard (session cookie) |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | admin client (bypasses RLS) |
| `WHATSAPP_VERIFY_TOKEN` | for WA | webhook GET verification |
| `META_APP_SECRET` | for WA | webhook signature validation |
| `WHATSAPP_API_KEY` | for WA | Meta Graph API bearer token |
| `FLOW_PRIVATE_KEY_PEM`, `FLOW_PRIVATE_KEY_PASSPHRASE` | for flows | WhatsApp Flow payload decryption |
| `RESEND_API_KEY` | for mail | Resend adapter |
| `AI_MODEL` | no | default agent model (defaults in `lib/agents/runtime.ts`) |
| `INNGEST_DEV` | dev | routes Inngest calls to the local dev server |

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
                  resolve tenant + agent + entitlements → run agent (generateText
                  with tools) → persist messages + usage_events → bump usage_counters
                  → emit message/outbound.send
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

## 5. Auth & multi-tenancy — read this twice

Two distinct access layers:

1. **RLS (data layer)** — every tenant-scoped table is protected by policies
   keyed on `auth_tenant_ids()` (a `SECURITY DEFINER` function that reads
   `tenant_members`) or `is_god_user()` (checks `god_users` by email claim).
   See `supabase/migrations/initial-schema.sql` §8.
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
- `plans` — a named set of `limits` (the entitlement engine, see §6).
- `subscriptions` — a tenant's current plan. One active subscription per tenant
  (creating a new active one cancels the previous).

---

## 6. Entitlements & the `plans.limits` shape

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

## 7. Conventions — follow these, or the code will fight you

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
5. **Tenant scoping is non-negotiable** in services (see §5).
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

---

## 8. Adding a new resource — the 4-step pattern

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

## 9. Database

Full schema in `supabase/migrations/initial-schema.sql` (730 lines, sections
1–8) plus `003_ingest_pipeline.sql` (scheduled messages), `004_agent_tool_seed.sql`
(tool backfill for existing agents), `support-whatsapp-flows.sql` (flows /
flow_sessions / campaign_schedules).

Highlights:
- **Platform:** `god_users`, `tenants`, `tenant_members`, `plans`,
  `subscriptions`, `usage_counters` (period buckets), `usage_events` (per-call).
- **Channels:** `wa_accounts`, `mail_accounts`, `whatsapp_templates`.
- **Conversations:** `contacts`, `conversations`, `messages`, `scheduled_messages`,
  `webhook_events` (idempotency).
- **Booking engine:** `businesses`, `resources`, `services`, `service_schemas`,
  `availability_rules`/`availability_exceptions`, `bookings`.
- **AI:** `agents`, `agent_tools`, `agent_channels`, `knowledge_base_documents`
  + `knowledge_base_chunks` (pgvector).

**FK reality:** child tables have plain FKs (no `ON DELETE CASCADE`). Deletes
must happen deepest-first. `deleteTenant` (`lib/services/tenants.ts`) and
`deleteBusiness` (`lib/services/businesses.ts`) encode the correct ordering —
if you add a table that references `tenants` or `businesses`, add it to those
delete lists.

---

## 10. Commands

```bash
npm run dev          # dev server
npm run build        # production build (Next requires all route handlers to compile)
npm run lint         # eslint — must be 0 errors before pushing
npx tsc --noEmit     # typecheck — run before lint; the client is untyped so most bugs surface here
```

There is no test suite yet. Typecheck + lint are the verification gate.

---

## 11. Things that will surprise you (learned the hard way)

- The DB stores lowercase statuses; Meta uses uppercase. Normalize at the
  boundary (`templates` sync and `outbound-message.ts` were both bitten by this).
- `subscriptions` allows multiple rows per tenant — "current plan" is always
  `status='active'` (see `resolveEntitlements`). Never assume one row.
- Route handlers are on the edge runtime; they must stay fast and only enqueue.
  Anything heavier belongs in an Inngest function.
- `@supabase/ssr` is used only for reading the session JWT in guards; route
  handlers can't write cookies, so the client's cookie `setAll` is a no-op.
- The `supabase/.temp/` directory is CLI state — it's gitignored, don't commit it.
