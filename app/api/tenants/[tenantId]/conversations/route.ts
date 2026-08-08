import { requireTenantAccess } from "@/lib/auth/guard";
import { handleError, ok } from "@/lib/http";
import { listConversations } from "@/lib/services/conversations";

type Ctx = { params: Promise<{ tenantId: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  try {
    const { tenantId } = await params;
    await requireTenantAccess(tenantId);
    return ok({ conversations: await listConversations(tenantId) });
  } catch (e) {
    return handleError(e);
  }
}
