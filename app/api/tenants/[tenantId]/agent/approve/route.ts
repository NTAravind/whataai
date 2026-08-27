import { NextRequest, NextResponse } from "next/server";
import { requireTenantAccess } from "@/lib/auth/guard";
import { handleError } from "@/lib/http";
import { approvePendingAction, rejectPendingAction } from "@/lib/agents/graph/hitl";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> },
) {
  try {
    const { tenantId } = await params;
    const auth = await requireTenantAccess(tenantId);

    const body = await req.json();
    const { actionId, action, reason } = body as {
      actionId: string;
      action: "approve" | "reject";
      reason?: string;
    };

    if (!actionId || !action) {
      return NextResponse.json({ error: "actionId and action required" }, { status: 400 });
    }

    if (action === "approve") {
      const result = await approvePendingAction(actionId, auth.id);
      if (!result.success) return NextResponse.json({ error: result.error }, { status: 404 });
      return NextResponse.json({ ok: true });
    }

    if (action === "reject") {
      const result = await rejectPendingAction(actionId, reason ?? "Rejected", auth.id);
      if (!result.success) return NextResponse.json({ error: result.error }, { status: 404 });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (e) {
    return handleError(e);
  }
}
