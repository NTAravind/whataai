import { requireTenantAccess } from "@/lib/auth/guard";
import { handleError, ok, noContent } from "@/lib/http";
import { getAutomation, updateAutomation, deleteAutomation } from "@/lib/services/automations";

type Ctx = { params: Promise<{ tenantId: string; automationId: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  try {
    const { tenantId, automationId } = await params;
    await requireTenantAccess(tenantId);
    return ok({ automation: await getAutomation(tenantId, automationId) });
  } catch (e) {
    return handleError(e);
  }
}

export async function PATCH(request: Request, { params }: Ctx) {
  try {
    const { tenantId, automationId } = await params;
    await requireTenantAccess(tenantId);
    const body = (await request.json()) as Record<string, unknown>;
    const automation = await updateAutomation(tenantId, automationId, body);
    return ok({ automation });
  } catch (e) {
    return handleError(e);
  }
}

export async function DELETE(_request: Request, { params }: Ctx) {
  try {
    const { tenantId, automationId } = await params;
    await requireTenantAccess(tenantId);
    await deleteAutomation(tenantId, automationId);
    return noContent();
  } catch (e) {
    return handleError(e);
  }
}