import { eventType } from "inngest";
import { z } from "zod";

/**
 * Typed event catalog (Inngest v4 `eventType()` — replaces v3 `EventSchemas`).
 * Every event the system produces or consumes is declared here so that
 * `inngest.send()`, `step.sendEvent()`, `step.waitForEvent()`, and function
 * triggers share one type definition.
 */

export const contentSchema = z.object({
  type: z.enum(["text", "template", "flow", "tool_call", "tool_result"]),
  text: z.string().optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
});

export const whatsappBulkSend = eventType("whatsapp/bulk.send", {
  schema: z.object({
    tenantId: z.string().uuid(),
    templateName: z.string(),
    contactIds: z.array(z.string()),
    variables: z.record(z.string(), z.string()).optional(),
  }),
});

// ---------------------------------------------------------------------------
// Inbound webhook raw payloads (route → ingest function)
// ---------------------------------------------------------------------------

export const whatsappWebhookReceived = eventType("whatsapp/webhook.received", {
  schema: z.object({
    channel: z.literal("whatsapp"),
    eventType: z.enum(["message", "status", "template"]),
    providerEventId: z.string(), // wamid.… (prefixed with type at the route)
    tenantId: z.string().uuid().optional(),
    waAccountId: z.string().uuid().optional(),
    raw: z.unknown(),
  }),
});

export const mailWebhookReceived = eventType("mail/webhook.received", {
  schema: z.object({
    channel: z.literal("mail"),
    eventType: z.literal("message"),
    providerEventId: z.string(),
    tenantId: z.string().uuid().optional(),
    mailAccountId: z.string().uuid().optional(),
    raw: z.unknown(),
  }),
});

// ---------------------------------------------------------------------------
// Normalized internal event — everything downstream is channel-agnostic
// ---------------------------------------------------------------------------

export const messageInbound = eventType("message/inbound", {
  schema: z.object({
    tenantId: z.string().uuid(),
    channel: z.enum(["whatsapp", "mail"]),
    channelAccountId: z.string().uuid(),
    providerMessageId: z.string(),
    conversationId: z.string().uuid(),
    contactId: z.string().uuid(),
    senderId: z.string(), // WA phone number or email
    content: contentSchema,
    receivedAt: z.string(),
  }),
});

// ---------------------------------------------------------------------------
// Outbound sends (dashboard / server actions → durable send function)
// ---------------------------------------------------------------------------

export const messageOutboundSend = eventType("message/outbound.send", {
  schema: z.object({
    tenantId: z.string().uuid(),
    channel: z.enum(["whatsapp", "mail"]),
    channelAccountId: z.string().uuid(),
    conversationId: z.string().uuid().optional(),
    contactId: z.string().uuid(),
    senderId: z.string(),
    content: contentSchema,
    templateId: z.string().uuid().optional(),
    messageId: z.string().uuid().optional(),
    agentId: z.string().uuid().nullable().optional(),
    scheduledMessageId: z.string().uuid().optional(),
  }),
});

// ---------------------------------------------------------------------------
// WhatsApp delivery status callbacks (sent/delivered/read/failed)
// ---------------------------------------------------------------------------

export const whatsappMessageStatus = eventType("whatsapp/message.status", {
  schema: z.object({
    providerMessageId: z.string(),
    status: z.enum(["sent", "delivered", "read", "failed"]),
    error: z.record(z.string(), z.unknown()).optional(),
  }),
});

// ---------------------------------------------------------------------------
// Scheduled (delayed) message dispatch — event `ts` drives the timing
// ---------------------------------------------------------------------------

export const scheduleMessageRun = eventType("schedule/message.run", {
  schema: z.object({
    scheduledMessageId: z.string().uuid(),
    tenantId: z.string().uuid(),
  }),
});

// ---------------------------------------------------------------------------
// WhatsApp Flows — every Flow HTTP round-trip is journaled through here so a
// mid-flow crash never loses the customer's answers.
// ---------------------------------------------------------------------------

export const flowDataExchange = eventType("flow/data.exchange", {
  schema: z.object({
    flowToken: z.string(),
    action: z.enum(["INIT", "data_exchange", "BACK", "ping", "error"]),
    screen: z.string().optional(),
    data: z.record(z.string(), z.unknown()).optional(),
  }),
});

// ---------------------------------------------------------------------------
// Knowledge base ingestion
// ---------------------------------------------------------------------------

export const kbDocumentUploaded = eventType("kb/document.uploaded", {
  schema: z.object({
    documentId: z.string().uuid(),
    tenantId: z.string().uuid(),
  }),
});

// ---------------------------------------------------------------------------
// Booking reminders
// ---------------------------------------------------------------------------

export const bookingReminderDue = eventType("booking/reminder.due", {
  schema: z.object({
    bookingId: z.string().uuid(),
    tenantId: z.string().uuid(),
  }),
});
