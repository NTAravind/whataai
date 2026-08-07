import { NextResponse } from "next/server";
import { sendWhatsAppTemplate, HttpError } from "@/lib/services/wa-send";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Send a WhatsApp template message via the durable outbound pipeline.
 * `templateId` must belong to the tenant's wa_account.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body.to !== "string" || typeof body.templateId !== "string") {
    return NextResponse.json({ error: "to and templateId are required" }, { status: 400 });
  }

  try {
    const result = await sendWhatsAppTemplate({
      to: body.to,
      templateId: body.templateId,
      params: body.params,
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
    console.error("send-template failed", err);
    return NextResponse.json({ error: "send failed" }, { status: 500 });
  }
}
