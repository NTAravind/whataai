import { requireTenantAccess } from "@/lib/auth/guard";
import { handleError, ok, created } from "@/lib/http";
import { listIntegrations, createIntegration } from "@/lib/services/integrations";

type Ctx = { params: Promise<{ tenantId: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  try {
    const { tenantId } = await params;
    await requireTenantAccess(tenantId);
    return ok({ integrations: await listIntegrations(tenantId) });
  } catch (e) {
    return handleError(e);
  }
}

export async function POST(request: Request, { params }: Ctx) {
  try {
    const { tenantId } = await params;
    await requireTenantAccess(tenantId);
    const body = (await request.json()) as Record<string, unknown>;
    const integration = await createIntegration(tenantId, {
      name: String(body.name ?? ""),
      type: String(body.type ?? ""),
      baseUrl: body.baseUrl ? String(body.baseUrl) : null,
      config: (body.config as Record<string, unknown> | undefined) ?? undefined,
      credential: body.credential ? String(body.credential) : undefined,
    });
    return created({ integration });
  } catch (e) {
    return handleError(e);
  }
}