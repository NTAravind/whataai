# REST API Reference

Internal HTTP API for the WA Agent Platform. All endpoints are server-side
route handlers (`app/api/**/route.ts`). Sends are **durable**: the HTTP call
only enqueues an Inngest event and returns immediately — the actual Meta/Resend
call happens in a background function, so failures retry automatically.

Base URL is your app domain. All request/response bodies are JSON (except the
WhatsApp Flow endpoint, which is AES-GCM encrypted).

---

## Sending messages

Sends resolve the target `wa_accounts` row (via `waAccountId` — the DB uuid — or
`waPhoneNumberId` — the Meta phone number id), look up or create the contact and
an active conversation, and enqueue `message/outbound.send`. The `messages` row
is created synchronously with status `queued`; delivery callbacks
(sent/delivered/read/failed) arrive via the status webhook.

Shared body fields (all three send endpoints):

| Field | Type | Required | Notes |
|---|---|---|---|
| `to` | string | yes | E.164 WhatsApp number, e.g. `+16505551234` |
| `tenantId` | uuid | no | Defaults to the wa_account's tenant |
| `waAccountId` | uuid | no | `wa_accounts.id` |
| `waPhoneNumberId` | string | no | Meta phone number id (used when `waAccountId` omitted) |
| `conversationId` | uuid | no | Attach to an existing conversation; else one is created |

Require `waAccountId` **or** `waPhoneNumberId`. Sends fail with `403` if the
contact has opted out (`contacts.opt_out`).

### POST /api/whatsapp/message/send-text

Send a free-form text message (free tier — only valid inside the 24h window).

```json
{ "to": "+16505551234", "waPhoneNumberId": "1184259564780993", "text": "Hi!" }
```

**201** response:

```json
{ "messageId": "…", "conversationId": "…", "status": "queued" }
```

### POST /api/whatsapp/message/send-template

Send an approved template. `templateId` must belong to the wa_account.

```json
{
  "to": "+16505551234",
  "waAccountId": "…",
  "templateId": "…",
  "params": { "1": "Acme" }
}
```

**201** response:

```json
{ "messageId": "…", "conversationId": "…", "status": "queued" }
```

### POST /api/whatsapp/message/services

Service/utility message — same as `send-template` but the template must have
`category === "UTILITY"` (session-window-expired notifications, etc.).

```json
{ "to": "+16505551234", "waAccountId": "…", "templateId": "…" }
```

**201** response:

```json
{ "messageId": "…", "conversationId": "…", "status": "queued" }
```

---

## WhatsApp templates

`whatsapp_templates` is the source of truth; Meta is the async authority for
approval status (PENDING → APPROVED/REJECTED via
`message_template_status_update` webhook).

### POST /api/whatsapp/templates/create

Persist locally (status `pending`), then submit to Meta.

```json
{
  "tenantId": "…",
  "waAccountId": "…",
  "name": "order_update",
  "language": "en_US",
  "category": "UTILITY",
  "components": [
    { "type": "BODY", "text": "Your order {{1}} is on the way." }
  ],
  "subCategory": "ORDER_STATUS",
  "messageSendTtlSeconds": 86400
}
```

`category` is one of `MARKETING | UTILITY | AUTHENTICATION`. **201** returns the
created row (status `pending`, `meta_template_id` set once Meta responds). If
the Meta submission fails, the row is marked `rejected` with `rejection_reason`.

### POST /api/whatsapp/templates/delete

Delete from Meta (best-effort) and locally. Also accepts `DELETE`.

```json
{ "tenantId": "…", "templateId": "…" }
```

**200** → `{ "deleted": true }`.

### GET /api/whatsapp/templates/status

Query params: `templateId`, `tenantId`. **200** returns the full template row
including `status`, `meta_template_id`, `rejection_reason`, `quality_score`.

---

## Channel webhooks (Meta / Resend call these)

### GET /api/whatsapp/webhooks

Meta's subscription verification handshake (`hub.mode=subscribe` +
`hub.verify_token`). Returns the `hub.challenge` on success, else 403.

### POST /api/whatsapp/webhooks

Meta delivery webhook. Must be a public HTTPS URL and ACK fast (<5s). When
`META_APP_SECRET` is set, the `X-Hub-Signature-256` header is validated (else
requests are rejected with 403). Enqueues one Inngest event per message
(`wa-msg-<wamid>`), per status (`wa-status-<id>-<status>`), and per template
status update (`wa-template-<template_id>`). Always responds 200 on success;
500 if enqueueing fails (so Meta retries).

### POST /api/whatsapp/flows

WhatsApp Flows data-exchange endpoint. Body is `{ encrypted_flow_data,
encrypted_aes_key, initial_vector }`. Decrypts with the Flow private key,
journals the round-trip through `flow/data.exchange` (durable), and returns an
encrypted response. A Flow `data_exchange` that completes a booking creates a
`bookings` row. Returns **421** on decryption failure so the client re-fetches
the public key.

### POST /api/mail/webhooks

Resend inbound webhook. Non-`email.received` events are ACKed immediately;
inbound mail is enqueued as `mail-<id>` → `mail/webhook.received` → `message/inbound`.

---

## Inngest

### GET|POST|PUT /api/ingest

Serves the Inngest SDK (all functions registered). Used by the Inngest dev
server / cloud to dispatch function runs and events. `maxDuration = 60`.

---

## Admin (god-mode) — tenants & billing

God-mode endpoints require a Supabase Auth session whose email is in the
`god_users` table (docs/guide.md §4). They operate via the service-role client.

### GET|POST /api/admin/tenants

List all tenants, or create one.

```json
// POST
{ "name": "Acme Corp", "status": "active" }
```

**201** → `{ "tenant": { "id", "name", "status", "created_at", "updated_at" } }`

### GET|PATCH|DELETE /api/admin/tenants/[tenantId]

Get a tenant (with `members` and active `subscription`), update
`{ "name"?, "status"? }`, or hard-delete the tenant and everything it owns
(cascade order: usage, members, subscriptions, webhook events, KB, business
subtree, flows/bookings, conversations/messages, agents, channels, templates).

### GET|POST /api/admin/tenants/[tenantId]/members

List members, or add one. `role` is `owner` | `admin` | `member`.

```json
{ "user_id": "…", "role": "member" }
```

### PATCH|DELETE /api/admin/tenants/[tenantId]/members/[memberId]

Update `{ "role" }` or remove a member.

### GET|POST /api/admin/plans

List plans (`?active=true` filters to active ones) or create one. `limits`
validates against the canonical shape (guide §3) — unknown keys are stripped.

```json
{
  "name": "Pro",
  "is_active": true,
  "limits": {
    "max_agents": 3,
    "max_wa_accounts": 2,
    "allowed_agent_types": ["receptionist", "appointments"],
    "allowed_channels": ["whatsapp", "mail"],
    "token_budget_monthly": 500000,
    "model_tier": "pro",
    "enforcement": "hard"
  }
}
```

### GET|PATCH|DELETE /api/admin/plans/[planId]

Get/update/delete a plan. Delete returns `409` if the plan is in use by a
subscription.

### GET|POST /api/admin/subscriptions

List subscriptions (`?tenant_id=<uuid>` filters) or assign a plan to a tenant.
Creating an `active` subscription auto-cancels any other active subscription on
the same tenant. `status` is `active` | `trialing` | `past_due` | `canceled` |
`expired`.

```json
{ "tenant_id": "…", "plan_id": "…", "status": "active", "ends_at": null }
```

### GET|PATCH|DELETE /api/admin/subscriptions/[subscriptionId]

Get/update a subscription. `DELETE ?cancel=true` sets status `canceled`;
otherwise the row is hard-deleted.

### GET|POST /api/admin/god-users

List god users or add one by email (`{ "email" }`). Adding is idempotent-safe
(`409` on duplicate).

### DELETE /api/admin/god-users/[userId]

Revoke god-mode access.

---

## Tenants — account & channel management

Tenant endpoints require a Supabase Auth session that is a row in
`tenant_members` for `[tenantId]`.

### GET|POST /api/tenants/[tenantId]/businesses

List businesses, or create one (`{ "name", "industry"?, "timezone"?,
"metadata"? }`).

### GET|PATCH|DELETE /api/tenants/[tenantId]/businesses/[businessId]

Get/update/delete a business. Delete cascades its `service_schemas`, `services`,
`availability_rules`/`availability_exceptions`, `resources`, and `bookings`.

### GET|POST /api/tenants/[tenantId]/wa-accounts

List WhatsApp accounts, or register one
(`{ "wa_phone_number_id", "display_phone_number", "wa_business_account_id",
"status"?, "metadata"? }`).

### GET|PATCH|DELETE /api/tenants/[tenantId]/wa-accounts/[waAccountId]

Get/update/delete a WhatsApp account.

### GET|POST /api/tenants/[tenantId]/mail-accounts

List mail accounts, or register one (`{ "email_address", "provider",
"credentials"?, "status"? }`).

### GET|PATCH|DELETE /api/tenants/[tenantId]/mail-accounts/[mailAccountId]

Get/update/delete a mail account.

### GET|POST /api/tenants/[tenantId]/resources

List bookable resources, or create one
(`{ "businessId", "name", "type"?, "capacity"? }`; `type` defaults to
`staff`).

### GET|PATCH|DELETE /api/tenants/[tenantId]/resources/[resourceId]

Get/update/delete a resource. PATCH accepts `{ "name"?, "type"?,
"capacity"?, "metadata"?, "enabled"? }`. Delete removes the resource and its
referencing `availability_exceptions`, `availability_rules`, and `bookings`
rows (deepest-first, the platform has no cascading FKs).

---

## Error responses

All endpoints return `{ "error": "…" }`. Common statuses:

| Status | Meaning |
|---|---|
| 400 | Malformed body / missing required field / wrong template category |
| 401 | No Supabase Auth session |
| 403 | Not a god user / not a tenant member / signature mismatch / contact opted out |
| 404 | WhatsApp account / conversation / template / plan / subscription / tenant not found |
| 409 | Duplicate god user / duplicate member / plan in use |
| 421 | Flow payload decryption failed |
| 500 | Supabase, Meta, or Inngest failure (details logged server-side) |

---

## Environment variables

| Variable | Used by |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | DB access (admin client) |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Auth session guard (admin/tenant routes) |
| `WHATSAPP_VERIFY_TOKEN` | webhook GET verification |
| `META_APP_SECRET` | webhook signature validation (strict mode) |
| `WHATSAPP_API_KEY` | Meta Graph API bearer token (via `lib/meta/whatsapp`) |
| `FLOW_PRIVATE_KEY_PEM`, `FLOW_PRIVATE_KEY_PASSPHRASE` | Flow request decryption |
| `RESEND_API_KEY` | Mail adapter |
| `AI_MODEL` | Default agent model |
| `INNGEST_DEV` | Inngest dev-mode routing |
