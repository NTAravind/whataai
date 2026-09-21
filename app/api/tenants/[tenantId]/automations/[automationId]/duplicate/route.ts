import { requireTenantAccess } from "@/lib/auth/guard";
import { handleError, created } from "@/lib/http";
import { duplicateAutomation } from "@/lib/services/automations";

type Ctx = { params: Promise<{ tenantId: string; automationId: string }> };

export async function POST(_request: Request, { params }: Ctx) {
  try {
    const { tenantId, automationId } = await params;
    await requireTenantAccess(tenantId);
    const automation = await duplicateAutomation(tenantId, automationId);
    return created({ automation });
  } catch (e) {
    return handleError(e);
  }
}