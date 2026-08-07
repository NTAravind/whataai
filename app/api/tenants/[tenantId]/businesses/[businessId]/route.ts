import { requireTenantAccess } from "@/lib/auth/guard";
import { handleError, ok, noContent } from "@/lib/http";
import { deleteBusiness, getBusiness, updateBusiness } from "@/lib/services/businesses";

type Ctx = { params: Promise<{ tenantId: string; businessId: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  try {
    const { tenantId, businessId } = await params;
    await requireTenantAccess(tenantId);
    return ok({ business: await getBusiness(tenantId, businessId) });
  } catch (e) {
    return handleError(e);
  }
}

export async function PATCH(request: Request, { params }: Ctx) {
  try {
    const { tenantId, businessId } = await params;
    await requireTenantAccess(tenantId);
    const body = (await request.json()) as {
      name?: string;
      industry?: string | null;
      timezone?: string;
      metadata?: Record<string, unknown>;
    };
    return ok({ business: await updateBusiness(tenantId, businessId, body) });
  } catch (e) {
    return handleError(e);
  }
}

export async function DELETE(_request: Request, { params }: Ctx) {
  try {
    const { tenantId, businessId } = await params;
    await requireTenantAccess(tenantId);
    await deleteBusiness(tenantId, businessId);
    return noContent();
  } catch (e) {
    return handleError(e);
  }
}
