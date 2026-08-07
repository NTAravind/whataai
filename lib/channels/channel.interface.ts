/**
 * Channel abstraction (docs/guide.md §6).
 *
 * Orchestration code (`lib/inngest/functions/message-inbound.ts`) talks only
 * to this interface. Adding a new channel (Instagram, SMS) = one new adapter
 * in `lib/channels`, zero changes to the agent or orchestration code.
 */

export type Channel = "whatsapp" | "mail";

/** Normalized inbound message shape — the internal event payload for `message/inbound`. */
export interface InboundMessage {
  channel: Channel;
  /** Provider's message id (wamid…, Resend message id, …). Used for dedup. */
  providerMessageId: string;
  /** The sender's address as seen by the channel (WA phone number, email). */
  senderId: string;
  /** Channel account id in our DB (wa_accounts.id / mail_accounts.id). */
  channelAccountId: string;
  content: {
    type: "text" | "template" | "flow" | "tool_call" | "tool_result";
    text?: string;
    meta?: Record<string, unknown>;
  };
  receivedAt: string;
}

export interface SendResult {
  providerMessageId?: string;
  status: "queued" | "sent" | "failed";
  error?: string;
}

/** Tenant-scoped context resolved before any send. */
export interface ChannelCtx {
  tenantId: string;
  channelAccountId: string; // wa_accounts.id or mail_accounts.id
  /** Last time the customer wrote to us — drives WA message-tier selection. */
  lastInboundAt?: string | null;
}

export interface TemplateRef {
  name: string;
  language: string;
  components?: Record<string, unknown>[];
  /** For scheduled/campaign sends: parameters to inject into the template. */
  params?: Record<string, unknown>;
}

export interface FlowRef {
  flowId: string;
  ctaText: string;
  data?: Record<string, unknown>;
}

export interface ChannelAdapter {
  channel: Channel;

  /** Send a free-form text message. */
  sendText(ctx: ChannelCtx, to: string, text: string): Promise<SendResult>;

  /** Send a template message (required on WA outside the 24h window). */
  sendTemplate?(ctx: ChannelCtx, to: string, template: TemplateRef): Promise<SendResult>;

  /** Trigger a WhatsApp Flow (structured data collection). */
  triggerFlow?(ctx: ChannelCtx, to: string, flow: FlowRef): Promise<SendResult>;

  /** Parse a raw webhook payload into normalized inbound messages. */
  parseWebhook(raw: unknown): {
    messages: InboundMessage[];
    statuses: { providerMessageId: string; status: "sent" | "delivered" | "read" | "failed"; error?: Record<string, unknown> }[];
  };
}
