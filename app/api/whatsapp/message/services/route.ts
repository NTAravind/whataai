import { NextResponse } from "next/server";
import { sendUtilityMessage, HttpError } from "@/lib/services/wa-send";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Service/utility message send (docs/guide.md §6) — used for
 * session-window-expired notifications and other cost-tier-aware sends.
 * Requires a UTILITY-category template.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body.to !== "string" || typeof body.templateId !== "string") {
    return NextResponse.json({ error: "to and templateId are required" }, { status: 400 });
  }
  if (!body.to || !body.templateId) {
    return NextResponse.json({ error: "to and templateId must not be empty" }, { status: 400 });
  }

  try {
    const result = await sendUtilityMessage({
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
    console.error("service message send failed", err);
    return NextResponse.json({ error: "send failed" }, { status: 500 });
  }
}
