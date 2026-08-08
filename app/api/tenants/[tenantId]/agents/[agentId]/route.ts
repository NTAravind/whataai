import { requireTenantAccess } from "@/lib/auth/guard";
import { handleError, ok, noContent } from "@/lib/http";
import { deleteAgent, getAgent, updateAgent, type UpdateAgentInput } from "@/lib/services/agents";

type Ctx = { params: Promise<{ tenantId: string; agentId: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  try {
    const { tenantId, agentId } = await params;
    await requireTenantAccess(tenantId);
    return ok({ agent: await getAgent(tenantId, agentId) });
  } catch (e) {
    return handleError(e);
  }
}

export async function PATCH(request: Request, { params }: Ctx) {
  try {
    const { tenantId, agentId } = await params;
    await requireTenantAccess(tenantId);
    const body = (await request.json()) as UpdateAgentInput;
    return ok({ agent: await updateAgent(tenantId, agentId, body) });
  } catch (e) {
    return handleError(e);
  }
}

export async function DELETE(_request: Request, { params }: Ctx) {
  try {
    const { tenantId, agentId } = await params;
    await requireTenantAccess(tenantId);
    await deleteAgent(tenantId, agentId);
    return noContent();
  } catch (e) {
    return handleError(e);
  }
}
