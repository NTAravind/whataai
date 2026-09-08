import { requireTenantAccess } from "@/lib/auth/guard";
import { handleError, ok } from "@/lib/http";
import { deleteResource, getResource, updateResource } from "@/lib/services/appointments";

type Ctx = { params: Promise<{ tenantId: string; resourceId: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  try {
    const { tenantId, resourceId } = await params;
    await requireTenantAccess(tenantId);
    return ok({ resource: await getResource(tenantId, resourceId) });
  } catch (e) {
    return handleError(e);
  }
}

export async function PATCH(request: Request, { params }: Ctx) {
  try {
    const { tenantId, resourceId } = await params;
    await requireTenantAccess(tenantId);
    const body = (await request.json()) as {
      name?: string;
      type?: string;
      capacity?: number | null;
      metadata?: Record<string, unknown>;
      enabled?: boolean;
    };
    return ok({ resource: await updateResource(tenantId, resourceId, body) });
  } catch (e) {
    return handleError(e);
  }
}

export async function DELETE(_request: Request, { params }: Ctx) {
  try {
    const { tenantId, resourceId } = await params;
    await requireTenantAccess(tenantId);
    await deleteResource(tenantId, resourceId);
    return ok({ success: true });
  } catch (e) {
    return handleError(e);
  }
}