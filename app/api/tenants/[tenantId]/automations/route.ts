import { requireTenantAccess } from "@/lib/auth/guard";
import { handleError, ok, created } from "@/lib/http";
import { listAutomations, createAutomation } from "@/lib/services/automations";
import type { CreateAutomationInput } from "@/lib/services/automations";

type Ctx = { params: Promise<{ tenantId: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  try {
    const { tenantId } = await params;
    await requireTenantAccess(tenantId);
    return ok({ automations: await listAutomations(tenantId) });
  } catch (e) {
    return handleError(e);
  }
}

export async function POST(request: Request, { params }: Ctx) {
  try {
    const { tenantId } = await params;
    await requireTenantAccess(tenantId);
    const body = (await request.json()) as Record<string, unknown>;
    const automation = await createAutomation(tenantId, body as unknown as CreateAutomationInput);
    return created({ automation });
  } catch (e) {
    return handleError(e);
  }
}