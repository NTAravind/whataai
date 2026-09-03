# Implementation task: Custom Automations feature

## Context (read first)

This is the WA Agent Platform — a multi-tenant WhatsApp AI customer-service
backend. Next.js 16.2 App Router · Supabase (Auth/Postgres/RLS) · LangGraph +
LangChain driving the agent · Inngest for durable background jobs · Meta
Cloud API (WhatsApp) · Resend (mail) · shadcn/ui + Tailwind on the frontend.

Read `docs/backend.md` and `docs/guide.md` before writing anything — this
task must follow existing conventions exactly:

- Route handlers are thin; all real work happens in `lib/services/*` (data
  access) and `lib/inngest/functions/*` (background work). Never call
  Postgres or Meta directly from a route handler.
- Supabase client is untyped — cast every row (`data as XRow`), use
  `unwrap()` from `lib/clients/supabase.ts`.
- Errors: throw `HttpError(status, msg)` in services, catch with
  `handleError(e)` in every route.
- Next.js 16 route params are async: `{ params }: { params: Promise<{...}> }`.
- Every tenant-scoped query filters by `tenant_id` explicitly — RLS is a
  backstop, not the only guard.
- New background work: add the event to `lib/inngest/events.ts` (the typed
  catalog — source of truth), then a function in `lib/inngest/functions/`.
- Follow the "4-step pattern" (§9 of `docs/backend.md`) for any new
  tenant-scoped resource: migration → service → route → docs.
- Don't add comments unless they explain *why*, not *what*.

**Naming note:** the DB already has `flows`/`flow_sessions` for WhatsApp's
*native* interactive-form Flows, and an existing agent tool called
`trigger_flow` that fires those. This new feature is unrelated — call it
**"automations"** everywhere (tables, routes, components) so it's never
confused with WhatsApp Flows.

## Goal

Let a tenant build a sequence of steps that runs either automatically (after
the AI agent replies, or after a specific tool call) or on demand, to do
things like: POST data to their CRM, call an invoicing API and send the
customer a PDF or link, tag a contact, send a follow-up template. Steps chain
— a later step can use an earlier step's output (e.g. an invoice URL).

---

## Part A — Backend

### A1. Migration — `supabase/migrations/014_add_automations.sql`

```sql
create table integrations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  name text not null,
  type text not null,                          -- 'generic_webhook' | 'zoho_invoice' | 'quickbooks' | 'stripe' | ...
  base_url text,
  config jsonb not null default '{}',           -- non-secret: org_id, defaults
  credentials_encrypted bytea not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table automations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  agent_id uuid references agents(id),          -- null = applies to all agents
  name text not null,
  is_active boolean not null default true,
  trigger_type text not null check (trigger_type in ('after_agent_reply','on_tool_call','manual')),
  trigger_config jsonb not null default '{}',   -- {"tool_name": "create_booking"} for on_tool_call
  steps jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table automation_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  automation_id uuid not null references automations(id),
  conversation_id uuid references conversations(id),
  contact_id uuid references contacts(id),
  status text not null default 'running' check (status in ('running','completed','failed')),
  step_results jsonb not null default '[]',     -- [{ index, type, status, output|error }]
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
```

Add RLS policies to all three tables copying the `tenant_id`-scoped policy
block from `wa_accounts` (same `auth_tenant_ids()` / `is_god_user()`
pattern). Add `integrations`, `automations`, `automation_runs` to the
FK-ordered delete lists in `deleteTenant` (`lib/services/tenants.ts`) — this
schema has no cascading deletes, deepest-first only. Encrypt
`credentials_encrypted` the same way `006_wa_account_credentials.sql` already
encrypts WhatsApp credentials — reuse that helper, don't reinvent it.

### A2. Types — `lib/automations/types.ts`

```ts
import { z } from "zod";

export const stepSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("api_call"),
    integrationId: z.string().uuid().optional(),
    url: z.string().url().optional(),
    method: z.enum(["GET", "POST", "PUT", "PATCH"]),
    headers: z.record(z.string()).optional(),
    body: z.string().optional(),               // supports {{var}} interpolation
    responseType: z.enum(["json", "binary"]).default("json"),
  }).refine(s => s.integrationId || s.url, "either integrationId or url is required"),
  z.object({ type: z.literal("send_message"), text: z.string() }),
  z.object({ type: z.literal("send_template"), templateId: z.string() }),
  z.object({
    type: z.literal("send_document"),
    mediaId: z.string().optional(),
    url: z.string().optional(),
    filename: z.string().optional(),
  }).refine(s => s.mediaId || s.url, "either mediaId or url is required"),
  z.object({ type: z.literal("tag_contact"), tag: z.string() }),
  z.object({ type: z.literal("wait"), seconds: z.number().min(1).max(3600) }),
]);

export const automationStepsSchema = z.array(stepSchema).min(1);
export type AutomationStep = z.infer<typeof stepSchema>;

export const captureFieldSchema = z.object({
  name: z.string(),                 // becomes the variable name, e.g. "customer_name"
  type: z.enum(["string", "number"]),
  description: z.string(),          // shown to the LLM as the tool param description
  required: z.boolean().default(true),
  saveToContact: z.boolean().default(false),
});

export const triggerConfigSchema = z.union([
  z.object({ tool_name: z.string() }),                    // on_tool_call
  z.object({ fields: z.array(captureFieldSchema).min(1) }), // ai_capture
  z.object({}).strict(),                                    // after_agent_reply / manual — no config
]);
```

`trigger_type` on the `automations` migration check-constraint must include
`ai_capture` alongside `after_agent_reply` / `on_tool_call` / `manual`.

### A2.5 Dynamic capture tool — `lib/automations/capture-tool.ts`

For `ai_capture` automations, the AI needs a tool to call once it's gathered
the fields conversationally — build it the same way the booking engine
already builds a dynamic Zod tool from `service_schemas` ("generic tool
loop"). Wherever the agent's tool list is assembled for a conversation
(`lib/agents/registry.ts` or wherever tools get composed before the
LangGraph run), add: for every active `ai_capture` automation scoped to that
agent, generate a tool named `capture_${automation.id}` whose Zod schema
comes from `trigger_config.fields`, and whose description explicitly tells
the model to ask conversationally for any missing field before calling it.
Its `execute()` does not call the CRM — it just `inngest.send()`s
`automation/triggered` with the tool's own arguments as `variables`, and (for
any field with `saveToContact: true`) also calls the existing contact-update
service. The `api_call` step's `body` then interpolates the captured fields
directly (`{{customer_name}}`), not nested under a `step_N` key, since
they're the top-level variables for that run.



### A3. Step executors — `lib/automations/executors.ts`

One function per step type, dictionary lookup (mirror the pattern in
`lib/agents/registry.ts`, don't write a big switch). `api_call` with
`responseType: "binary"` reads `res.arrayBuffer()` and immediately uploads to
Meta's media endpoint (add `uploadMedia(waAccountId, buffer, mimeType)` to
`lib/meta/whatsapp.ts` if it isn't there yet), returning `{ mediaId }`.
`send_message`/`send_template`/`send_document` all go through
`lib/services/wa-send.ts` — never call Meta directly from an executor.
Template interpolation (`{{contact.name}}`, `{{step_0.invoice_url}}`) is a
small helper — replace `{{a.b.c}}` by walking the variables object, no
templating library needed for this.

Never write decrypted `credentials_encrypted` values into
`automation_runs.step_results` — log response bodies, not request headers.

### A4. Inngest — event + function

Add to `lib/inngest/events.ts`:

```ts
"automation/triggered": z.object({
  automationId: z.string().uuid(),
  tenantId: z.string().uuid(),
  conversationId: z.string().uuid().optional(),
  contactId: z.string().uuid().optional(),
  variables: z.record(z.unknown()).default({}),
})
```

`lib/inngest/functions/automation-run.ts`: loads the automation, creates an
`automation_runs` row, runs each step in its own `step.run()` (durability —
same guarantee the rest of the pipeline relies on), `wait` steps use
`step.sleep()` not a blocking delay, accumulates each step's output into
`variables` under `step_{i}` for later interpolation, stops the chain and
marks the run `failed` on the first step error, marks `completed` at the end.

### A5. Trigger emission

`after_agent_reply`: in `lib/inngest/functions/message-inbound.ts`, after the
reply is persisted, load active automations for that agent with
`trigger_type = 'after_agent_reply'` and `inngest.send()` one
`automation/triggered` event per match.

`on_tool_call`: in `lib/agents/graph/nodes.ts` (`createToolNode` /
`createHitlToolNode`), after a tool executes, check active
`on_tool_call` automations whose `trigger_config.tool_name` matches the tool
that just ran, and emit the same event.

### A6. Service + routes (4-step pattern)

- `lib/services/integrations.ts` — list/get/create/update/delete, tenant-scoped,
  encrypts credentials on write, never returns decrypted credentials from a
  `list`/`get` call (return a masked indicator only, e.g. `hasCredentials: true`).
- `lib/services/automations.ts` — list/get/create/update/delete, validates
  `steps` against `automationStepsSchema` and `trigger_config` against
  `triggerConfigSchema` on write.
- `lib/services/automation-runs.ts` — `listRuns(tenantId, automationId)`,
  `getRun(tenantId, runId)` — read-only, populated by the Inngest function.
- Routes:
  - `app/api/tenants/[tenantId]/integrations/route.ts` + `[integrationId]/route.ts`
  - `app/api/tenants/[tenantId]/automations/route.ts` + `[automationId]/route.ts`
  - `app/api/tenants/[tenantId]/automations/[automationId]/runs/route.ts` (list runs)
- Guard every route with `requireTenantAccess(tenantId)`.
- Add all endpoints to `docs/rest-api.md`.

---

## Part B — Frontend (shadcn/ui)

New dashboard section, tenant-scoped: **Automations**. Use existing shadcn
primitives already in the project (`components/ui/*`) — don't introduce a
different component library or hand-roll what shadcn already provides
(`Table`, `Card`, `Dialog`, `Sheet`, `Select`, `Tabs`, `Badge`, `Form`,
`Input`, `Textarea`, `Switch`, `DropdownMenu`, `Separator`, `Skeleton` for
loading states, `Sonner`/`toast` for feedback).

### B1. Automations list — `app/(dashboard)/automations/page.tsx`

- `Table` of automations: name, trigger type (`Badge`, color per type), active
  toggle (`Switch`, patches `is_active` inline), last run status
  (`Badge`: green completed / red failed / gray never run), "New automation"
  button top-right opening the builder.
- Row click → automation detail/builder page. Row `DropdownMenu` (⋮) for
  duplicate / delete (delete behind an `AlertDialog` confirm).
- Empty state: centered `Card` with a short explanation + "New automation" CTA.

### B2. Automation builder — `app/(dashboard)/automations/[automationId]/page.tsx`
(and a `/new` route reusing the same client component)

Layout: two-column. Left column (`Card`) — settings: `Input` for name,
`Select` for agent (or "All agents"), `Select` for trigger type
(`after_agent_reply` / `on_tool_call` / `ai_capture` / `manual`); when
`on_tool_call` is selected, reveal a second `Select` populated from the
tenant's enabled `agent_tools` for `trigger_config.tool_name`. When
`ai_capture` is selected, reveal a small repeatable field-list editor
instead: each row is `Input` (field name, e.g. `customer_name`), `Select`
(string/number), `Input` (description shown to the AI — placeholder text
"how should the AI describe this to itself, e.g. 'the customer's full
name'"), `Switch` (required), `Switch` (also save to contact record). "Add
field" button appends a row. This is the only trigger type where the step
list's `{{var}}` helper text should list the field names directly
(`customer_name`, `email`, …) rather than `contact.*`/`step_N.*`, since
they become top-level variables for that run.

Right column — **step list builder**: vertical list of step cards, each a
`Card` with a colored left-border by step type, a type icon
(`lucide-react`), a summary line, and expand/collapse to edit that step's
fields inline (`Form` + `zodResolver(stepSchema)` per step). Up/down
reorder buttons per card (simple array move, drag-and-drop is a nice-to-have,
not required for v1 — don't pull in a DnD library for this). "Add step"
button opens a `Dialog` with a `Select`-style grid of step type cards
(icon + one-line description) to pick from, then appends a default-config
step of that type to the list for editing.

Step-specific fields, each in its own `Form` block:
- **api_call**: `Select` (choose an existing `Integration` or "Custom URL"),
  if custom → `Input` for URL; `Select` for method; a `Textarea` for headers
  (JSON) and body (JSON, monospace font, supports `{{var}}` — show a small
  helper text listing available variables: `contact.name`,
  `conversation.lastMessage`, and `step_N.*` for every step before this one
  in the list); `Select` for response type (JSON / Binary file).
- **send_message**: `Textarea` for text, same `{{var}}` helper text below it.
- **send_template**: `Select` populated from the tenant's approved
  WhatsApp templates (existing `templates` list endpoint).
- **send_document**: `Select` (use previous step's output / static URL), and
  if "use previous step's output" is picked, a `Select` restricted to
  `api_call` steps above it with `responseType: binary`; `Input` for filename.
- **tag_contact**: `Input` for tag.
- **wait**: `Input type="number"` for seconds, with unit toggle (sec/min/hr)
  purely as UI sugar, always stored as seconds.

Bottom bar: sticky `Save` button (disabled until the whole form is valid via
a combined Zod schema check across all steps), `Cancel`. Saving does a full
`PUT` of the automation with the assembled `steps` array.

### B3. Integrations page — `app/(dashboard)/automations/integrations/page.tsx`

Simple `Table`: name, type (`Badge`), base URL, "Connected" indicator, ⋮ menu
(edit/delete). "Add integration" → `Sheet` (side panel) with `Form`: name,
type `Select` (Generic Webhook / Zoho Invoice / QuickBooks / Stripe / …),
base URL `Input`, and credential fields that change based on type: if the
selected type exists in `OAUTH_PROVIDERS` (Part C), replace the credential
inputs with a single `Button` — "Connect with {Provider}" — that navigates
to the OAuth start route below; otherwise show a plain API key
`Input type="password"`. On edit, never pre-fill the credential field with
the real value — show a masked placeholder and only overwrite on explicit
change.

### B4. Run history — tab on the automation detail page

`Tabs`: "Builder" / "Run history". Run history is a `Table`: started_at,
status (`Badge`), duration, contact. Row click expands (`Collapsible` or a
`Sheet`) showing `step_results` as a small vertical timeline — each step's
type, status icon (check/x/spinner), and its output/error in a collapsed
`<pre>` block.

---

## Part C — Generic OAuth for integrations (one flow, config per provider)

Goal: adding a new OAuth provider later means adding one config entry, not a
new route or a new UI branch. Two routes total, shared across every provider.

### C1. Migration addition — short-lived state table

```sql
create table oauth_states (
  state text primary key,
  tenant_id uuid not null references tenants(id),
  provider_type text not null,
  integration_name text not null,
  created_at timestamptz not null default now()
);
```

No cleanup job needed for v1 — `consumeOAuthState` (below) checks
`created_at > now() - interval '10 minutes'` and deletes on read either way.

### C2. Provider registry — `lib/integrations/oauth-providers.ts`

This is the *only* file that changes when you add a provider.

```ts
export const OAUTH_PROVIDERS = {
  zoho_invoice: {
    authorizeUrl: "https://accounts.zoho.com/oauth/v2/auth",
    tokenUrl: "https://accounts.zoho.com/oauth/v2/token",
    scopes: ["ZohoInvoice.invoices.CREATE", "ZohoInvoice.invoices.READ"],
    extraAuthParams: { access_type: "offline", prompt: "consent" },
    clientIdEnv: "ZOHO_CLIENT_ID",
    clientSecretEnv: "ZOHO_CLIENT_SECRET",
    extractExtra: (cb: URLSearchParams) => ({}),
  },
  quickbooks: {
    authorizeUrl: "https://appcenter.intuit.com/connect/oauth2",
    tokenUrl: "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
    scopes: ["com.intuit.quickbooks.accounting"],
    clientIdEnv: "QUICKBOOKS_CLIENT_ID",
    clientSecretEnv: "QUICKBOOKS_CLIENT_SECRET",
    extractExtra: (cb: URLSearchParams) => ({ realmId: cb.get("realmId") }),
  },
} as const;

export type OAuthProviderType = keyof typeof OAUTH_PROVIDERS;
```

`extractExtra` exists because some providers hand back a field in the
callback query string that isn't a token (QuickBooks' `realmId` identifies
*which* company was authorized) — store it in `integrations.config`, not
`credentials_encrypted`, since it's not secret.

### C3. Start route — `app/api/tenants/[tenantId]/integrations/oauth/start/route.ts`

Tenant-scoped, guarded with `requireTenantAccess`. Reads `type` + `name` from
the query string, writes an `oauth_states` row keyed by a random `state`,
builds the provider's authorize URL from the registry entry, redirects.
Never hand-build this per provider — every provider's authorize URL is just
`authorizeUrl + client_id + redirect_uri + scope + state + extraAuthParams`.

### C4. Callback route — `app/api/integrations/oauth/callback/route.ts`

**Not** tenant-scoped in the path — the redirect URI you register with every
provider's app console must be one static URL, so tenant/provider identity
comes from looking up `state` in `oauth_states`, not from the URL. Reads
`code` + `state`, calls `consumeOAuthState(state)` (looks up + deletes,
throws `HttpError(400, ...)` if missing/expired), exchanges `code` for
tokens at `provider.tokenUrl` (standard `grant_type=authorization_code` POST
— identical shape for every provider), runs `provider.extractExtra()` on the
callback params, and calls `createIntegration()` storing
`{ accessToken, refreshToken, expiresAt }` in `credentials_encrypted` (same
encryption helper as everywhere else) and `extractExtra`'s result in
`config`. Redirects back to `/automations/integrations?connected=1`.

### C5. Token refresh — `lib/integrations/token-refresh.ts`

```ts
export async function getValidAccessToken(integrationId: string): Promise<string> {
  const integration = await getIntegrationWithCredentials(integrationId); // decrypts
  if (integration.credentials.expiresAt > Date.now() + 60_000) {
    return integration.credentials.accessToken;
  }
  const provider = OAUTH_PROVIDERS[integration.type as OAuthProviderType];
  const res = await fetch(provider.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: integration.credentials.refreshToken,
      client_id: process.env[provider.clientIdEnv]!,
      client_secret: process.env[provider.clientSecretEnv]!,
    }),
  });
  if (!res.ok) throw new HttpError(502, "oauth refresh failed");
  const tokens = await res.json();
  await updateIntegrationCredentials(integrationId, {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? integration.credentials.refreshToken,
    expiresAt: Date.now() + tokens.expires_in * 1000,
  });
  return tokens.access_token;
}
```

Same function handles every provider — refresh is always
`grant_type=refresh_token` against `provider.tokenUrl`.

### C6. Wire it into `api_call`

In the `api_call` executor (§A3): if `integration.type` is a key in
`OAUTH_PROVIDERS`, call `getValidAccessToken(integrationId)` and set
`Authorization: Bearer {token}` automatically — the tenant never types an
auth header for OAuth integrations, only for `generic_webhook` ones.

### Why this stays provider-agnostic

Every OAuth2 "authorization code" provider — Zoho, QuickBooks, Xero, most
others — follows the identical redirect → code → token-exchange → refresh
shape. The only per-provider differences are: the two URLs, the scopes, and
occasionally one extra field in the callback (`extractExtra`). All three live
in one object in the registry. The routes, the state table, the encryption,
and the refresh logic never change per provider — that's what makes adding
provider #3 a five-minute config change instead of a new feature.

---

## Acceptance criteria

- Tenant can create an automation with a mix of step types, save it, and see
  it listed with correct trigger badge.
- Toggling `is_active` off stops it from firing without deleting it.
- An `after_agent_reply` automation actually fires after a real inbound
  message is handled (verify via a run row appearing in run history).
- An `api_call` step with `responseType: binary` followed by `send_document`
  successfully delivers a WhatsApp document message end to end.
- Integration credentials are never returned in any API response after
  creation, and never appear in `automation_runs.step_results`.
- `npx tsc --noEmit` and `npm run lint` both pass with 0 errors before this
  is considered done (there is no test suite yet — these are the gate).
- Connecting a Zoho (or QuickBooks) integration via the "Connect with…"
  button completes the redirect round-trip and the integration shows as
  connected without ever exposing a token in the UI or API response.
- An `api_call` step against an OAuth integration works with an expired
  access token (i.e. refresh actually fires) without the tenant doing
  anything.
