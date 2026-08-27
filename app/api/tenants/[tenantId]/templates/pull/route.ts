import { NextResponse } from "next/server";
import { requireTenantAccess } from "@/lib/auth/guard";
import { pullTemplatesFromMeta } from "@/lib/services/templates";

export const runtime = "nodejs";
export const maxDuration = 60;

type Ctx = { params: Promise<{ tenantId: string }> };

export async function POST(request: Request, { params }: Ctx) {
  const { tenantId } = await params;
  const body = await request.json().catch(() => null);
  if (!body || typeof body.waAccountId !== "string") {
    return NextResponse.json({ error: "waAccountId is required" }, { status: 400 });
  }
  if (!body.waAccountId) {
    return NextResponse.json({ error: "waAccountId must not be empty" }, { status: 400 });
  }

  try {
    await requireTenantAccess(tenantId);
    const templates = await pullTemplatesFromMeta(tenantId, body.waAccountId);
    return NextResponse.json({ templates });
  } catch (e) {
    console.error("pull-templates-from-meta failed", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "failed to pull templates" },
      { status: 500 },
    );
  }
}
