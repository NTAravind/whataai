import { requireGodUser } from "@/lib/auth/guard";
import { handleError, ok, created } from "@/lib/http";
import { createSubscription, listSubscriptions } from "@/lib/services/subscriptions";

export async function GET(request: Request) {
  try {
    await requireGodUser();
    const { searchParams } = new URL(request.url);
    const tenantId = searchParams.get("tenant_id") ?? undefined;
    return ok({ subscriptions: await listSubscriptions(tenantId ? { tenant_id: tenantId } : undefined) });
  } catch (e) {
    return handleError(e);
  }
}

export async function POST(request: Request) {
  try {
    await requireGodUser();
    const body = (await request.json()) as {
      tenant_id?: string;
      plan_id?: string;
      status?: string;
      starts_at?: string;
      ends_at?: string | null;
      metadata?: Record<string, unknown>;
    };
    if (!body.tenant_id) return handleError(new Error("tenant_id is required"));
    if (!body.plan_id) return handleError(new Error("plan_id is required"));
    return created({
      subscription: await createSubscription({
        tenant_id: body.tenant_id,
        plan_id: body.plan_id,
        status: body.status,
        starts_at: body.starts_at,
        ends_at: body.ends_at,
        metadata: body.metadata,
      }),
    });
  } catch (e) {
    return handleError(e);
  }
}
