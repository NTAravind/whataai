import { DEFAULT_MODEL, listAvailableModels } from "@/lib/agents/provider";
import { requireTenantAccess } from "@/lib/auth/guard";
import { handleError, ok } from "@/lib/http";

type Ctx = { params: Promise<{ tenantId: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  try {
    const { tenantId } = await params;
    await requireTenantAccess(tenantId);
    return ok({ models: await listAvailableModels(), defaultModel: DEFAULT_MODEL });
  } catch (error) {
    return handleError(error);
  }
}
