# Feature: Tenant Management Chat (AI Business Assistant)

You are working in the WA Agent Platform repo (Next.js 16 App Router · Supabase ·
Vercel AI SDK `ai@7` + Gemini · Inngest · Meta Cloud API). Read `docs/backend.md`
and `docs/guide.md` before starting — follow every existing convention in them
(thin route handlers, `lib/services/*` data-access layer, tenant scoping,
lowercase DB statuses, async route params, etc). Do not deviate from those
patterns for this feature.

## Goal

Add a tenant-facing chat page where a tenant user talks to an AI "business
assistant" that can manage the business conversationally — e.g. "create a
template for the sale on this product and send it to all my contacts." The
assistant must:

1. Be a **distinct agent** from the customer-facing receptionist/sales agent
   already in `lib/agents/` — this one runs synchronously in an interactive
   chat, not from the inbound webhook pipeline.
2. Render a **WhatsApp-style preview** of any template it drafts.
3. **Never send anything or submit anything to Meta without explicit tenant
   approval** in the UI first. Draft → preview → approve → execute is
   mandatory for every template creation and every bulk send.

## 1. Database

Add a migration `supabase/migrations/0XX_management_chat.sql`:

- `management_chat_threads (id, tenant_id, user_id, title, created_at, updated_at)`
- `management_chat_messages (id, thread_id, role, content jsonb, tool_calls jsonb, created_at)`

Use a separate table from `conversations`/`messages` — those assume a
`contact_id` and are customer-facing; this is tenant-internal. RLS policies
keyed the same way as every other tenant table (`auth_tenant_ids()` /
`is_god_user()`) — copy the pattern from an existing table's policy block.

Reuse the existing `whatsapp_templates` table for drafts/approved templates
and the existing `campaign_schedules` table (from migration `002`) for bulk
sends — don't invent parallel tables for either.

## 2. Agent + tools

New module, parallel to the existing customer agent runtime:

```
lib/agents/management/
  registry.ts   # tool catalog for this agent
  runtime.ts    # streamText loop (interactive, not generateText)
```

The agent should have tools over **every tenant-scoped resource** in
`app/api/tenants/[tenantId]/` — not just templates. Generate the tool set
directly from `lib/services/*`: every aggregate that already has a service
file (`businesses`, `resources`, `appointment-services` (services table),
`availability-rules`, `bookings`, `contacts`, `agents`, `wa-accounts`,
`mail-accounts`, `members`, `kb-documents`, `templates`) gets `list_X` /
`get_X` / `create_X` / `update_X` / `delete_X` tools wherever a
list/get/create/update/delete exists on that service. Don't hand-roll new
data access for this — the tool `execute` functions are thin wrappers that
call the existing `lib/services/*` functions, exactly like the route handlers
do.

Tool catalog, grouped by risk tier:

| Tier | Examples | Confirmation? |
|---|---|---|
| **Read** | `list_contacts`, `get_contact`, `list_resources`, `list_services`, `list_bookings`, `list_availability_rules`, `list_agents`, `list_wa_accounts`, `list_kb_documents`, `list_members`, `list_templates`, `get_usage_summary` | no |
| **Low-risk write** | `create_resource`, `update_resource`, `create_service`, `update_service`, `create_availability_rule`, `update_availability_rule`, `create_contact`, `update_contact`, `create_business`, `update_business`, `create_booking`, `update_booking`, `create_template` (drafts only, see §3) | no — execute directly, but always report back what was created/changed in the reply so the tenant can review after the fact |
| **Destructive** | `delete_resource`, `delete_service`, `delete_availability_rule`, `delete_contact`, `delete_booking`, `delete_business`, `delete_agent`, `delete_wa_account`, `delete_member` | **yes** |
| **High blast radius** | `submit_template` (→ Meta), `send_template_campaign` (→ all/many contacts) | **yes** |

Every tool's `execute` closure receives `tenantId` injected by the route
handler — never trust a `tenantId` argument the model might produce. Every
tool must go through the *same* tenant-scoped service function the REST route
for that resource uses, so RLS/entitlement/validation behavior can't drift
between the two surfaces.

Note deletes deliberately sit in their own confirmation tier even though
they're "just CRUD" — irreversible data loss gets the same treatment as
sending a campaign. Low-risk creates/updates (a new resource, a tweaked
availability rule) don't need a blocking confirmation card, but the agent
should still state clearly in its reply what it did, since the tenant can't
see the DB directly.

### Confirmation-required tools

For `submit_template` and `send_template_campaign`, use the AI SDK v7
client-side-tool pattern: define the tool with no `execute` on the server.
The model emits a tool call, the stream pauses, and the frontend renders a
confirmation card. When the tenant approves, the frontend sends the tool
result back (`addToolResult` / a follow-up message) to resume the
conversation, and *that* triggers the real backend call. The model itself
never fires these actions — only the user's click does.

## 3. Template drafting + preview

`create_template`:
- Zod-validates `{ name, category, language, header?, body, footer?, buttons? }`.
- Inserts into `whatsapp_templates` with `status = 'draft'` — **do not** call
  Meta yet, drafts get edited before submission.
- Returns a `template_preview` object mirroring the WhatsApp bubble layout
  (header/body/footer/buttons) so the frontend can render it without another
  round trip.

Frontend `TemplatePreviewCard`: a static phone-frame-styled component (green
header bar, message bubble, footer, quick-reply buttons) driven purely by the
template JSON — no Meta call needed for the preview itself. Buttons: *Approve
& Submit*, *Edit*, *Discard*.

Approve calls `POST /api/tenants/[tenantId]/templates/[templateId]/submit`
(thin route → `lib/services/templates.ts` → `lib/meta/whatsapp.ts` to
actually register the template with Meta). Update status at the boundary the
usual way (Meta returns uppercase, store lowercase).

## 4. Send-to-all-contacts flow

`send_template_campaign` tool: params `{ templateId, contactFilter }`. It only
**computes and returns a recipient count** (a read) — it does not send
anything. Frontend shows "Send *[template name]* to *N* contacts?" with
Approve/Cancel.

On approve, `POST /api/tenants/[tenantId]/campaigns`:
- Thin route → creates a `campaign_schedules` row → emits an Inngest event
  (`campaign/dispatch.requested`).
- New `lib/inngest/functions/campaign-dispatch.ts`: loads contacts, fans out
  `message/outbound.send` per contact through the **existing** outbound
  pipeline (same adapter/retry/entitlement path already used for regular
  sends) — no new send logic, just a new fan-out source.
- A template can only be selected for a campaign once its status is
  `approved` (synced from Meta), never while `draft`/`pending`.

## 5. API routes

- `POST /api/tenants/[tenantId]/chat` — streaming (`streamText(...).toDataStreamResponse()`), guarded by `requireTenantAccess`.
- `GET/POST /api/tenants/[tenantId]/chat/threads` — thread history CRUD.
- `POST /api/tenants/[tenantId]/templates/[templateId]/submit` — draft → Meta.
- `POST /api/tenants/[tenantId]/campaigns` — create + enqueue a bulk send.

All thin: guard → parse → call service → `handleError(e)` on catch, per
existing convention.

## 6. Frontend

New page under the tenant dashboard (match existing route grouping), using
`useChat` from `ai/react`:

- Plain assistant text renders normally.
- Tool calls render as cards: `TemplatePreviewCard`, `CampaignConfirmCard`,
  `ContactsListCard`, `UsageSummaryCard`.
- Approving a card triggers its backend route, then feeds a synthetic
  follow-up ("Approved") back into the chat so the agent can confirm and
  continue.

## 7. Guardrails specific to this feature

- Check `resolveEntitlements(tenantId)` (token budget) before allowing a chat
  turn, same as the inbound message pipeline does.
- Log every chat completion's cost via `calculateCost` into `usage_events`
  (new event type, e.g. `management_chat`) so this path isn't invisible to
  billing/entitlements.
- Any `delete_*` tool, plus `submit_template` and `send_template_campaign`,
  are gated behind the confirmation-required tool pattern — irreversible or
  broad-blast-radius actions always pause for a click. Reads and low-risk
  creates/updates execute freely, but should be echoed back in the reply.
- Respect existing entitlement limits when creating resources through chat
  (e.g. `max_agents`, `max_wa_accounts` from `plans.limits`) — a `create_agent`
  or `create_wa_account` tool must hit the same entitlement check the REST
  route does, not bypass it because it came from the model.

## 8. Suggested build order

1. Migration for `management_chat_threads`/`management_chat_messages`.
2. `lib/agents/management/` with **read-only** tools across every resource
   (`list_*`/`get_*`); verify the chat route streams end-to-end with a
   bare-bones page.
3. Low-risk write tools (`create_*`/`update_*` for resources, services,
   availability rules, contacts, businesses, bookings) — thin wrappers over
   existing `lib/services/*`, no confirmation UI needed yet.
4. `create_template` + `TemplatePreviewCard` + submit route (confirmation
   pattern lands here first, since it's the most contained case).
5. Generalize the confirmation pattern to `delete_*` tools (a generic
   "confirm this action" card works for all of them, not just templates).
6. `send_template_campaign` + `CampaignConfirmCard` + campaigns route +
   `campaign-dispatch` Inngest function.
7. Wire usage/cost logging and entitlement checks last, once the happy path
   works.