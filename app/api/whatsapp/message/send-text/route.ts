import { NextResponse } from "next/server";
import { sendWhatsAppText, HttpError } from "@/lib/services/wa-send";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Manual/agent-triggered WhatsApp text send (docs/guide.md §6).
 * Wraps the durable outbound pipeline: resolves the wa_account + contact +
 * conversation, then enqueues `message/outbound.send` — the actual Meta call
 * happens in the Inngest function.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body.to !== "string" || typeof body.text !== "string") {
    return NextResponse.json({ error: "to and text are required" }, { status: 400 });
  }
  if (!body.to || !body.text) {
    return NextResponse.json({ error: "to and text must not be empty" }, { status: 400 });
  }

  try {
    const result = await sendWhatsAppText({
      to: body.to,
      text: body.text,
      tenantId: body.tenantId,
      waAccountId: body.waAccountId,
      waPhoneNumberId: body.waPhoneNumberId,
      conversationId: body.conversationId,
    });
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("send-text failed", err);
    return NextResponse.json({ error: "send failed" }, { status: 500 });
  }
}
