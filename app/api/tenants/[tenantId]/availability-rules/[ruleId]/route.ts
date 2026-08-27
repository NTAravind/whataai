import { requireTenantAccess } from "@/lib/auth/guard";
import { handleError, noContent } from "@/lib/http";
import { deleteAvailabilityRule } from "@/lib/services/appointments";

type Ctx = { params: Promise<{ tenantId: string; ruleId: string }> };

export async function DELETE(_request: Request, { params }: Ctx) {
  try {
    const { tenantId, ruleId } = await params;
    await requireTenantAccess(tenantId);
    await deleteAvailabilityRule(tenantId, ruleId);
    return noContent();
  } catch (e) {
    return handleError(e);
  }
}
