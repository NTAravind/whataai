# Task: Fix date/time hallucination in AI agents

## Context

This is the WA Agent Platform backend — a multi-tenant WhatsApp AI customer-service
system. Stack: Next.js 16.2 (App Router), Supabase, Vercel AI SDK (`ai@7`) +
Google Gemini, Inngest for durable background jobs.

Agent replies are generated via `generateText` in `lib/agents/runtime.ts`, using
tools defined in `lib/agents/registry.ts`. The booking engine is generic/schema-driven
(`businesses`, `resources`, `services`, `service_schemas`, `availability_rules`,
`availability_exceptions`, `bookings`) — see `docs/backend.md` §9 for the schema.

**The bug:** the AI agent hallucinates the current date and time. It has no innate
sense of "now," so relative references ("today", "tomorrow", "next Monday") get
resolved against whatever the model's training data implies, not the actual current
time. This is especially dangerous in the booking flow, where a wrong "today" can
create a booking tool call with an incorrect or past `booking_start`.

## Goal

Make the agent's date/time resolution deterministic and server-verified, not
model-guessed. Three layers of defense:

1. Inject the real current date/time (in the business's timezone) into the system
   prompt on every `generateText` call, with explicit resolution rules.
2. Re-validate any date/time value the model emits in a tool call server-side
   before it's used for a booking write — never trust the model's date arithmetic.
3. Optionally expose a `get_current_datetime` tool the agent can call mid-conversation
   as a fallback/refresh mechanism.

## Implementation

### 1. `lib/agents/runtime.ts` — inject current date/time into the system prompt

Find where the system prompt is currently assembled before the `generateText` call.
Add a `buildSystemPrompt` (or equivalent) step that runs **fresh on every call** —
do not cache the rendered prompt string across turns, since the whole point is that
it must never go stale.

```ts
function buildDateTimeBlock(timezone: string): string {
  const now = new Date();
  const nowFormatted = new Intl.DateTimeFormat('en-US', {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone: timezone,
  }).format(now);

  return `
## Current date & time
Right now it is: ${nowFormatted} (${timezone})

Rules for handling dates and times:
- This timestamp is ground truth. Never guess, assume, or recall the date from your own training — always resolve it from the value above.
- Resolve every relative date/time reference ("today", "tomorrow", "next Monday", "in 2 weeks", "this evening") against this exact timestamp before using it in any tool call or response.
- If a user's requested date/time is ambiguous (e.g. "Friday" without a date, or a time with no AM/PM), ask for clarification instead of guessing.
- When calling any booking or availability tool, always pass fully resolved ISO 8601 date/time values (e.g. "2026-08-21T15:00:00+05:30") — never relative phrases like "tomorrow".
- If the resolved date falls in the past relative to the current timestamp, flag it back to the user rather than silently proceeding.
- Do not state the current date/time to the user unless they ask — use it internally for resolution only.
`.trim();
}
```

Resolve `timezone` from the tenant's `business` record if a timezone column
exists; otherwise fall back to a platform default (`'UTC'` or whatever the
codebase already uses for date formatting elsewhere — check for consistency
before hardcoding).

Wire it in wherever the system prompt is currently built:

```ts
const systemPrompt = `${baseSystemPrompt}\n\n${buildDateTimeBlock(timezone)}`;
```

Confirm this is recomputed per-invocation, not memoized, and not part of any
Gemini prompt-caching block that persists across turns in a conversation.

### 2. Server-side date validation before booking writes

Locate the booking tool handler(s) in `lib/agents/registry.ts` (or wherever the
tool `execute` functions live) that accept a `booking_start` / date-time field.

Before passing the model-supplied value through to `lib/services/bookings.ts` or
the availability-check logic:

- Parse the value strictly (reject anything that isn't valid ISO 8601).
- Compare it against the server's actual current time (same `now` computed in
  step 1, not re-derived).
- If the parsed date/time is in the past, or is more than some sane upper bound
  in the future (e.g. > 1 year — adjust to whatever's reasonable for this
  business), reject the tool call with a clear error message the agent can
  surface back to the user (e.g. "That date has already passed — did you mean a
  different day?") rather than silently creating the booking.
- Do not attempt to "fix" or reinterpret an invalid date on the model's behalf —
  reject and let the agent re-ask, so errors stay visible instead of silently
  papered over.

Add this as a small shared helper (e.g. `lib/agents/date-validation.ts`) so it's
reusable across any tool that takes a date/time argument, not just bookings.

### 3. (Optional but recommended) `get_current_datetime` tool

In `lib/agents/registry.ts`, add a lightweight tool the agent can call directly
mid-conversation, useful for long conversations or multi-step booking flows
where the system-prompt timestamp might otherwise feel stale to the model:

```ts
{
  name: 'get_current_datetime',
  description: 'Returns the current date and time in the business timezone. Call this before resolving any relative date reference if you are unsure.',
  parameters: z.object({}),
  execute: async ({ timezone }: { timezone: string }) => {
    const now = new Date();
    return {
      iso: now.toISOString(),
      formatted: new Intl.DateTimeFormat('en-US', {
        dateStyle: 'full',
        timeStyle: 'short',
        timeZone: timezone,
      }).format(now),
      timezone,
    };
  },
}
```

Register it in the default tool set alongside the existing booking tools.

## Acceptance criteria

- [ ] Every `generateText` call includes a freshly computed current date/time in
      the system prompt, correct to the business's timezone.
- [ ] The date/time block is never cached or reused stale across turns.
- [ ] A tool call proposing a `booking_start` (or any other date field) in the
      past, or with an unparseable value, is rejected server-side before it
      reaches the booking service — verify with a manual test: ask the agent to
      book "yesterday" and confirm it does not create a booking.
- [ ] Ambiguous relative dates ("Friday" with no date, no year) trigger a
      clarifying question rather than a guessed value — verify manually.
- [ ] `get_current_datetime` tool (if implemented) is registered and callable.
- [ ] `npx tsc --noEmit` and `npm run lint` both pass with 0 errors.
- [ ] No comments added except where they explain *why* (per repo convention in
      `docs/backend.md` §7.10).

## Do not

- Do not change the `messages` content shape or `lib/inngest/events.ts` event
  schemas as part of this fix — this is scoped to `lib/agents/runtime.ts`,
  `lib/agents/registry.ts`, and a new small validation helper only.
- Do not add a new env var for timezone — resolve it from the business/tenant
  record if available, falling back to a sane default.
- Do not silently "correct" a bad date from the model — reject and let the
  agent re-prompt the user.
