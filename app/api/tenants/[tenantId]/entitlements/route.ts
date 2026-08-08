import { requireTenantAccess } from "@/lib/auth/guard";
import { handleError, ok } from "@/lib/http";
import { resolveEntitlements } from "@/lib/entitlements/resolve";

type Ctx = { params: Promise<{ tenantId: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  try {
    const { tenantId } = await params;
    await requireTenantAccess(tenantId);
    return ok({ entitlements: await resolveEntitlements(tenantId) });
  } catch (e) {
    return handleError(e);
  }
}
