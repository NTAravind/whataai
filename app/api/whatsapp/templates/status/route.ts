import { NextResponse } from "next/server";
import { getTemplate } from "@/lib/services/templates";

export const runtime = "nodejs";
export const maxDuration = 30;

/** Return the current approval status (+ full row) of a template. */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const templateId = searchParams.get("templateId");
  const tenantId = searchParams.get("tenantId");
  if (!templateId || !tenantId) {
    return NextResponse.json({ error: "templateId and tenantId are required" }, { status: 400 });
  }

  try {
    const template = await getTemplate(templateId, tenantId);
    return NextResponse.json({ template }, { status: 200 });
  } catch (err) {
    console.error("get-template failed", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "template not found" }, { status: 500 });
  }
}
