import { requireTenantAccess } from "@/lib/auth/guard";
import { handleError, ok, noContent } from "@/lib/http";
import { getIntegration, updateIntegration, deleteIntegration } from "@/lib/services/integrations";

type Ctx = { params: Promise<{ tenantId: string; integrationId: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  try {
    const { tenantId, integrationId } = await params;
    await requireTenantAccess(tenantId);
    return ok({ integration: await getIntegration(tenantId, integrationId) });
  } catch (e) {
    return handleError(e);
  }
}

export async function PATCH(request: Request, { params }: Ctx) {
  try {
    const { tenantId, integrationId } = await params;
    await requireTenantAccess(tenantId);
    const body = (await request.json()) as Record<string, unknown>;
    const integration = await updateIntegration(tenantId, integrationId, {
      name: body.name !== undefined ? String(body.name) : undefined,
      baseUrl: body.baseUrl !== undefined ? (body.baseUrl === null ? null : String(body.baseUrl)) : undefined,
      config: body.config !== undefined ? (body.config as Record<string, unknown>) : undefined,
      credential: body.credential !== undefined ? String(body.credential) : undefined,
    });
    return ok({ integration });
  } catch (e) {
    return handleError(e);
  }
}

export async function DELETE(_request: Request, { params }: Ctx) {
  try {
    const { tenantId, integrationId } = await params;
    await requireTenantAccess(tenantId);
    await deleteIntegration(tenantId, integrationId);
    return noContent();
  } catch (e) {
    return handleError(e);
  }
}