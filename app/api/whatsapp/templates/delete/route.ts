import { NextResponse } from "next/server";
import { deleteTemplate } from "@/lib/services/templates";

export const runtime = "nodejs";
export const maxDuration = 30;

/** Delete a WhatsApp template from Meta (best-effort) and locally. */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body.tenantId !== "string" || typeof body.templateId !== "string") {
    return NextResponse.json({ error: "tenantId and templateId are required" }, { status: 400 });
  }

  try {
    await deleteTemplate(body.templateId, body.tenantId);
    return NextResponse.json({ deleted: true }, { status: 200 });
  } catch (err) {
    console.error("delete-template failed", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "template deletion failed" }, { status: 500 });
  }
}

export { POST as DELETE };
