# Implementation plan — Custom Automations feature

This is the working implementation plan derived from
`docs/prompts/automations-opencode-prompt.md`, with corrections applied after
verifying against the actual repository at implementation time.

---

## Corrections to the original spec (verified against the repo)

1. **Migration numbering** — `014` and `015` already exist
   (`014_fix_recompute_usage_cost.sql`, `015_tenant_token_topup.sql`). New
   files will be `016_add_automations.sql` and `017_add_oauth_states.sql`.

2. **No credential-encryption helper exists** —
   `006_wa_account_credentials.sql` stores WhatsApp creds as plaintext `text`
   columns; there is no helper file. Create `lib/crypto/credentials.ts`
   (AES-256-GCM, `CREDENTIALS_ENCRYPTION_KEY` env var) and use it everywhere
   the spec says "reuse the existing helper". New env vars needed:
   `CREDENTIALS_ENCRYPTION_KEY`, `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`,
   `QUICKBOOKS_CLIENT_ID`, `QUICKBOOKS_CLIENT_SECRET` (documented, not written
   to `.env`).

3. **Form deps missing** — the project has no `react-hook-form`,
   `@hookform/resolvers`, or shadcn `form` component. Install RHF +
   `@hookform/resolvers` and add the shadcn `form` component before Part B.
   zod is v4 (`^4.4.3`) — full v4 support for the schemas confirmed.

4. **`send_document` does not exist anywhere in the stack** — add end-to-end:
   `uploadMedia()` + `sendDocumentMessage()` in `lib/meta/whatsapp.ts`, a
   `sendDocument` adapter method, `"document"` content type in
   `contentSchema`/`OutboundInput`/`ChannelAdapter`, a `sendWhatsAppDocument()`
   in `wa-send.ts`, and a branch in `outbound-message.ts`.

5. **Capture-tool injection point** — tools are composed in
   `buildLangChainTools` (LangGraph path via `graph.ts`/`supervisor.ts`) and
   `buildAgentTools`/`buildTenantAgentTools` (AI SDK path). Extend
   `buildLangChainTools`/`buildAgentTools` with an optional `agentId` param and
   append `capture_<id>` tools.

6. **Dashboard routes live under `app/dashboard/`** (not `(dashboard)` group):
   `app/dashboard/automations/**`.

7. **`trigger_config` for `on_tool_call`** uses `tool_name` from the tenant's
   `agent_tools` (distinct enabled tool names across the tenant's agents).

8. **`automation_runs.*` FK delete order** added to `TENANT_DELETE_ORDER`
   (deepest-first: automation_runs → automations → integrations →
   oauth_states). The `tenants.ts` list is authoritative; check whether
   `lib/services/businesses.ts` mirrors it and update both if so.

9. **Non-OAuth (API-key) integrations need an explicit credential-injection
   path** — the original spec only describes auto-injection for OAuth
   (`getValidAccessToken()` → auto `Authorization: Bearer`). For plain API-key
   integrations the decrypted credential is exposed to `recursiveInterpolate`
   as a template variable (`{{integration.credential}}`) that the tenant
   references themselves (e.g. `Authorization: Bearer {{integration.credential}}`
   or `X-API-Key: {{integration.credential}}`). This means
   `getIntegrationWithCredentials()` must also be called from `executors.ts`
   for any `api_call` step whose integration is NOT an `OAUTH_PROVIDERS` key.
   Same logging rule: the interpolated value itself must never be written into
   `step_results` — only response bodies get logged.

---

## Part A — Backend

### A1. `supabase/migrations/016_add_automations.sql`
- `integrations`, `automations`, `automation_runs` tables exactly as specced,
  but the `automations.trigger_type` check constraint includes all four types:
  `('after_agent_reply','on_tool_call','ai_capture','manual')`.
- `credentials_encrypted bytea not null` + default `'{}'` for `config`.
- RLS policies copying `wa_accounts.tenant_isolation_all` pattern
  (`auth_tenant_ids()` / `is_god_user()`), `ENABLE ROW LEVEL SECURITY` on all
  three tables.

### A1b. `supabase/migrations/017_add_oauth_states.sql`
- `oauth_states` table (state PK, tenant_id, provider_type, integration_name,
  created_at). Consumed on read with a 10-minute freshness check.

### A2. `lib/automations/types.ts`
- `stepSchema` (discriminated union — api_call / send_message / send_template
  / send_document / tag_contact / wait), `automationStepsSchema` (min 1),
  `captureFieldSchema`, `triggerConfigSchema` exactly as specced.

### A2.5. `lib/automations/capture-tool.ts`
- `buildCaptureTools(tenantId, agentId?, ctx)` → `ToolDef[]`, one per active
  `ai_capture` automation (`agent_id IS NULL OR agent_id = ?`).
- Zod schema built from `trigger_config.fields`; description tells the model to
  gather missing fields conversationally.
- `execute()`: does **not** call the CRM —
  `inngest.send("automation/triggered", { automationId, tenantId,
  conversationId, contactId, variables: args })`; updates the contact for any
  `saveToContact` fields via the contacts service.
- Wired into `buildLangChainTools(enabledTools, ctx, agentId?)` and
  `buildAgentTools(enabledTools, ctx, agentId?)`; `graph.ts`/`supervisor.ts`
  pass the agent id.

### A3. `lib/automations/executors.ts`
- `recursiveInterpolate(template, variables)` — walks `{{a.b.c}}`, no
  templating lib.
- One function per step type in a dictionary (mirrors `registry.ts` style).
  `api_call`: JSON → parse and return body; **binary** →
  `res.arrayBuffer()` → `uploadMedia(waAccountId, buffer, mimeType)` →
  `{ mediaId }`.
- `send_message`/`send_template`/`send_document` go through `wa-send.ts`
  (never Meta directly). Executors take a resolved context
  (`{ ev, automation, contact, conversation, waAccount }`).
- Never log request headers or decrypted credentials into `step_results` —
  only response bodies. Applies equally to OAuth bearer tokens and interpolated
  `{{integration.credential}}` values.
- **OAuth** `api_call`: if `integration.type` is an `OAUTH_PROVIDERS` key →
  `getValidAccessToken()` → auto `Authorization: Bearer`.
- **Non-OAuth** `api_call`: if `integration.type` is NOT an `OAUTH_PROVIDERS`
  key and the step references an integration →
  `getIntegrationWithCredentials()` → decrypt → expose as `integration.credential`
  in the interpolate variables. No automatic header injection.

### A3.5. Document-send plumbing
- `lib/meta/whatsapp.ts`: `sendDocumentMessage({ phoneNumberId, to, mediaId?,
  link?, filename?, caption?, accessToken })` and `uploadMedia`.
- `lib/channels/channel.interface.ts`: optional `sendDocument?`.
- `lib/channels/whatsapp.adapter.ts`: implement `sendDocument`.
- `lib/inngest/events.ts`: add `"document"` to `contentSchema.type`.
- `lib/services/messages.ts`: widen `OutboundInput.content.type` to include
  `"document"`.
- `lib/inngest/functions/outbound-message.ts`: add a `send-document` branch
  (mediaId/link via `content.meta`, template-free so free-tier-legal only).
- `lib/services/wa-send.ts`: add `sendWhatsAppDocument(...)` (resolves
  account/conversation/contact like the text variant).

### A4. `lib/inngest/events.ts` + `lib/inngest/functions/automation-run.ts`
- `automation/triggered` event exactly as specced.
- `automation-run.ts`: load automation → insert `automation_runs` (status
  `running`) → each step in its own `step.run()`; `wait` uses `step.sleep()`;
  accumulate output as `step_{i}`; first error → mark `failed` with `error` +
  per-step error, stop; success → `completed` + `finished_at`.
- Steps needing a recipient resolve contact phone + tenant wa_account in an
  early `step.run("resolve-context")`; fail fast if a phone/account is missing.

### A5. Trigger emission
- `after_agent_reply`: in `message-inbound.ts` after "enqueue-outbound", load
  active automations for `agent.id` (or `agent_id IS NULL`) with
  `trigger_type='after_agent_reply'`, emit one event each.
- `on_tool_call`: `lib/automations/trigger.ts` shared helper
  (`emitOnToolCall({ tenantId, agentId, conversationId, contactId, toolName })`).
  Wrap the standard `ToolNode` in `graph.ts` (replace `createToolNode(lcTools)`
  usage there) and call the same helper in `nodes.ts`
  `createHitlToolNode`'s post-invoke loop.
- `ai_capture`: handled inside `capture-tool.ts` `execute()`.
- `manual`: run history only (no hidden trigger in v1).

### A6. Services + routes (4-step pattern)
- `lib/crypto/credentials.ts`: AES-256-GCM encrypt/decrypt (bytea `Buffer`
  in/out), key from `CREDENTIALS_ENCRYPTION_KEY`.
- `lib/services/integrations.ts`: list (masked `hasCredentials: true`), get
  (masked), create (encrypt), update (decrypt → re-encrypt only if a new value
  is provided), delete; internal `getIntegrationWithCredentials()` /
  `updateIntegrationCredentials()` used by BOTH the OAuth refresh path and
  non-OAuth `api_call` steps (point 9).
- `lib/services/automations.ts`: CRUD with `automationStepsSchema` +
  `triggerConfigSchema` validation on write; duplicate helper.
- `lib/services/automation-runs.ts`: `listRuns(tenantId, automationId)`,
  `getRun(tenantId, runId)` — read-only.
- `lib/integrations/oauth-providers.ts`, `lib/integrations/token-refresh.ts`
  per spec (C2/C5).
- Routes (all guarded by `requireTenantAccess` unless noted):
  - `/api/tenants/[tenantId]/integrations/route.ts` + `[integrationId]/route.ts`
  - `/api/tenants/[tenantId]/integrations/oauth/start/route.ts` (C3)
  - `/api/integrations/oauth/callback/route.ts` (C4 — **not** tenant-scoped)
  - `/api/tenants/[tenantId]/automations/route.ts` + `[automationId]/route.ts`
  - `/api/tenants/[tenantId]/automations/[automationId]/runs/route.ts`
  - `/api/tenants/[tenantId]/automations/enabled-tools/route.ts`
- `lib/services/tenants.ts`: add 4 deepest-first delete steps to
  `TENANT_DELETE_ORDER`.
- Document all endpoints in `docs/rest-api.md`.

---

## Part B — Frontend (shadcn/ui)

Install `react-hook-form` + `@hookform/resolvers`; add the shadcn `form`
component.

### B1. `app/dashboard/automations/page.tsx`
Table (name, trigger `Badge` colored per type, `Switch` toggles `is_active`,
last-run status `Badge`), ⋮ menu (duplicate/delete behind `AlertDialog`),
empty-state `Card`, "New automation" CTA. Uses `useTenant` + `useApi` + `toast`
like the contacts page.

### B2. Builder — `app/dashboard/automations/[automationId]/page.tsx` (+ shared
client component for `/new`)
- Left `Card`: name `Input`, agent `Select` ("All agents"), trigger `Select`
  (4 types). `on_tool_call` → tool-name `Select` from the enabled-tools
  endpoint. `ai_capture` → repeatable field editor (name/type/description/
  required/saveToContact switches, "Add field").
- Right column: vertical step cards (`Card`, colored left-border + lucide icon
  + summary + expand to edit). Per-step `Form` + `zodResolver(stepSchema)`.
  Up/down reorder (array move, no DnD lib). "Add step" `Dialog` with a
  step-type grid; appends a default-config step.
- Step fields per spec. `api_call` var helper text: `contact.*`, `step_N.*`,
  and for non-OAuth integrations also `{{integration.credential}}` (point 9).
  For `ai_capture` triggers the helper lists the captured field names directly.
- `send_document`: source select (previous binary `api_call` step / static
  URL) + filename. `wait`: seconds with a sec/min/hr unit toggle.
- Sticky bottom bar: `Save` (full PUT, combined zod check across all steps) +
  `Cancel`.

### B3. `app/dashboard/automations/integrations/page.tsx`
Table (name, type `Badge`, base URL, Connected indicator, ⋮ edit/delete).
"Add integration" `Sheet` + `Form`: name, type `Select`, base URL, credential
field — OAuth types → "Connect with {Provider}" `Button` →
`/api/.../oauth/start`; else API-key `Input type="password"`. Edit never
pre-fills the real credential (masked placeholder, overwrite only on change).

### B4. Run history tab — automation detail page
`Tabs`: Builder / Run history. `Table` (started_at, status `Badge`, duration,
contact) → row expand (`Collapsible`/`Sheet`) with `step_results` vertical
timeline (`<pre>` output/error).

### B5. Shell
Add "Automations" to `secondaryNav` in `components/app-shell.tsx` (icon:
`Workflow` from lucide).

---

## Part C — Generic OAuth for integrations
Registry (`lib/integrations/oauth-providers.ts`), start route, callback route,
state table (`017`), `lib/integrations/token-refresh.ts`, and `api_call`
wiring — see A6/A3 above. Provider-agnostic: only the registry object changes
when adding a provider.

---

## Acceptance verification
- `npx tsc --noEmit` and `npm run lint` — 0 errors before done (the gate).
  No test suite exists.
- Manual compile check: `next build` for App Router routes + pages.

## Open items for the operator
- `.env`: add `CREDENTIALS_ENCRYPTION_KEY`, `ZOHO_CLIENT_ID/SECRET`,
  `QUICKBOOKS_CLIENT_ID/SECRET` (secrets kept out of the plan).
- `ai_capture` builder validates ≥1 field.