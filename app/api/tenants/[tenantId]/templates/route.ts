import { requireTenantAccess } from "@/lib/auth/guard";
import { handleError, ok } from "@/lib/http";
import { listTemplates } from "@/lib/services/templates";

type Ctx = { params: Promise<{ tenantId: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  try {
    const { tenantId } = await params;
    await requireTenantAccess(tenantId);
    return ok({ templates: await listTemplates(tenantId) });
  } catch (e) {
    return handleError(e);
  }
}
