import { NextResponse } from "next/server";
import { createTemplate } from "@/lib/services/templates";

export const runtime = "nodejs";
export const maxDuration = 30;

const CATEGORIES = ["MARKETING", "UTILITY", "AUTHENTICATION"];

/**
 * Create a WhatsApp template: persists locally first (status=pending), then
 * submits to Meta. Approval/quality changes arrive async via the
 * message_template_status_update webhook.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body.tenantId !== "string" || typeof body.waAccountId !== "string" || typeof body.name !== "string") {
    return NextResponse.json({ error: "tenantId, waAccountId and name are required" }, { status: 400 });
  }
  if (typeof body.language !== "string" || !CATEGORIES.includes(body.category)) {
    return NextResponse.json({ error: `language and category (${CATEGORIES.join(" | ")}) are required` }, { status: 400 });
  }
  if (!Array.isArray(body.components)) {
    return NextResponse.json({ error: "components (array) is required" }, { status: 400 });
  }

  try {
    const template = await createTemplate({
      tenantId: body.tenantId,
      waAccountId: body.waAccountId,
      name: body.name,
      language: body.language,
      category: body.category,
      components: body.components,
      subCategory: body.subCategory,
      messageSendTtlSeconds: body.messageSendTtlSeconds,
    });
    return NextResponse.json({ template }, { status: 201 });
  } catch (err) {
    console.error("create-template failed", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "template creation failed" },
      { status: 500 },
    );
  }
}
