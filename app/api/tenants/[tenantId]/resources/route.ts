import { requireTenantAccess } from "@/lib/auth/guard";
import { created, handleError, HttpError, ok } from "@/lib/http";
import { createResource, listResources } from "@/lib/services/appointments";

type Ctx = { params: Promise<{ tenantId: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  try {
    const { tenantId } = await params;
    await requireTenantAccess(tenantId);
    return ok({ resources: await listResources(tenantId) });
  } catch (e) {
    return handleError(e);
  }
}

export async function POST(request: Request, { params }: Ctx) {
  try {
    const { tenantId } = await params;
    await requireTenantAccess(tenantId);
    const body = (await request.json()) as {
      businessId?: string;
      name?: string;
      type?: string;
      capacity?: number | null;
    };
    if (!body.businessId) throw new HttpError(400, "businessId is required");
    if (!body.name?.trim()) throw new HttpError(400, "name is required");
    return created({
      resource: await createResource({
        tenantId,
        businessId: body.businessId,
        name: body.name.trim(),
        type: body.type?.trim() || "staff",
        capacity: body.capacity,
      }),
    });
  } catch (e) {
    return handleError(e);
  }
}
