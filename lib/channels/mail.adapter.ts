import type { ChannelAdapter, ChannelCtx, InboundMessage, SendResult } from "./channel.interface";

/**
 * Mail adapter — deliberately thin for MVP (docs/guide.md §9 defers mail
 * polish). It implements the ChannelAdapter contract so orchestration code is
 * channel-agnostic from day one; the Resend transport itself can be fleshed
 * out in Phase 2 without touching `message-inbound.ts`.
 */
export const mailAdapter: ChannelAdapter = {
  channel: "mail",

  async sendText(ctx: ChannelCtx, to: string, text: string): Promise<SendResult> {
    const { supabaseAdmin } = await import("@/lib/clients/supabase");
    const { data, error } = await supabaseAdmin()
      .from("mail_accounts")
      .select("email_address")
      .eq("id", ctx.channelAccountId)
      .single();

    if (error || !data) {
      return { status: "failed", error: "mail_account not found" };
    }

    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ from: data.email_address, to, text }),
      });
      if (!res.ok) {
        const body = await res.text();
        return { status: "failed", error: `Resend ${res.status}: ${body}` };
      }
      const json = (await res.json()) as { id?: string };
      return { providerMessageId: json.id, status: "queued" };
    } catch (err) {
      return { status: "failed", error: err instanceof Error ? err.message : String(err) };
    }
  },

  async sendTemplate(): Promise<SendResult> {
    // Template sends via Resend need a Resend "Template" — Phase 2.
    return { status: "failed", error: "mail templates not supported yet" };
  },

  parseWebhook(raw: unknown) {
    const messages: InboundMessage[] = [];
    const body = raw as {
      event?: string;
      data?: { id?: string; from?: string; to?: string; subject?: string; text?: string };
    };

    const data = body.data;
    if (body.event && data?.id && data?.from) {
      const match = /<([^>]+)>|([^<\s]+@[^>\s]+)/.exec(data.from);
      const senderEmail = match ? (match[1] ?? match[2] ?? data.from) : data.from;
      messages.push({
        channel: "mail",
        providerMessageId: data.id,
        senderId: senderEmail,
        channelAccountId: "", // resolved by tenant lookup in the ingest function
        content: {
          type: "text",
          text: data.text ?? data.subject ?? "",
          meta: { subject: data.subject, to: data.to },
        },
        receivedAt: new Date().toISOString(),
      });
    }
    return { messages, statuses: [] };
  },
};
