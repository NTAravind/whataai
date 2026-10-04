import { requireTenantAccess } from "@/lib/auth/guard";
import { handleError, ok } from "@/lib/http";
import { resolveTenantModelId, tenantModelOptions } from "@/lib/agents/model-access";

type Ctx = { params: Promise<{ tenantId: string }> };

/**
 * The model dropdown for a tenant.
 *
 * Returns only models that are switched on in /admin/models AND granted by the
 * tenant's plan (plans.limits.allowed_models). An empty list is possible if a
 * plan grants nothing, so `defaultModel` is always the resolved fallback the
 * server would pick rather than a bare platform constant.
 */
export async function GET(_request: Request, { params }: Ctx) {
  try {
    const { tenantId } = await params;
    await requireTenantAccess(tenantId);

    const [models, fallback] = await Promise.all([
      tenantModelOptions(tenantId),
      resolveTenantModelId(tenantId, undefined),
    ]);

    return ok({ models, defaultModel: fallback.model });
  } catch (error) {
    return handleError(error);
  }
}