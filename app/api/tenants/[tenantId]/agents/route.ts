import { requireTenantAccess } from "@/lib/auth/guard";
import { handleError, ok, created } from "@/lib/http";
import { createAgent, listAgents, type CreateAgentInput } from "@/lib/services/agents";

type Ctx = { params: Promise<{ tenantId: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  try {
    const { tenantId } = await params;
    await requireTenantAccess(tenantId);
    return ok({ agents: await listAgents(tenantId) });
  } catch (e) {
    return handleError(e);
  }
}

export async function POST(request: Request, { params }: Ctx) {
  try {
    const { tenantId } = await params;
    await requireTenantAccess(tenantId);
    const body = (await request.json()) as Partial<CreateAgentInput>;
    if (!body.name?.trim()) return handleError(new Error("name is required"));
    if (!body.type?.trim()) return handleError(new Error("type is required"));
    return created({
      agent: await createAgent({
        tenantId,
        type: body.type.trim(),
        name: body.name.trim(),
        instructions: body.instructions,
        model_config: body.model_config,
        tools: body.tools,
      }),
    });
  } catch (e) {
    return handleError(e);
  }
}
