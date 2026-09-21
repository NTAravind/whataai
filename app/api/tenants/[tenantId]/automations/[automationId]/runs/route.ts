import { requireTenantAccess } from "@/lib/auth/guard";
import { handleError, ok } from "@/lib/http";
import { getAutomation } from "@/lib/services/automations";
import { listRuns } from "@/lib/services/automation-runs";

type Ctx = { params: Promise<{ tenantId: string; automationId: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  try {
    const { tenantId, automationId } = await params;
    await requireTenantAccess(tenantId);
    await getAutomation(tenantId, automationId); // 404 if not found
    return ok({ runs: await listRuns(tenantId, automationId) });
  } catch (e) {
    return handleError(e);
  }
}