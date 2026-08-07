import { requireTenantAccess } from "@/lib/auth/guard";
import { handleError, ok, created } from "@/lib/http";
import { createBusiness, listBusinesses } from "@/lib/services/businesses";

type Ctx = { params: Promise<{ tenantId: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  try {
    const { tenantId } = await params;
    await requireTenantAccess(tenantId);
    return ok({ businesses: await listBusinesses(tenantId) });
  } catch (e) {
    return handleError(e);
  }
}

export async function POST(request: Request, { params }: Ctx) {
  try {
    const { tenantId } = await params;
    await requireTenantAccess(tenantId);
    const body = (await request.json()) as {
      name?: string;
      industry?: string | null;
      timezone?: string;
      metadata?: Record<string, unknown>;
    };
    if (!body.name?.trim()) return handleError(new Error("name is required"));
    return created({
      business: await createBusiness({
        tenant_id: tenantId,
        name: body.name.trim(),
        industry: body.industry,
        timezone: body.timezone,
        metadata: body.metadata,
      }),
    });
  } catch (e) {
    return handleError(e);
  }
}
