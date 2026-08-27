import { requireTenantAccess } from "@/lib/auth/guard";
import { handleError, HttpError, ok } from "@/lib/http";
import { getServiceSchema, updateServiceSchema } from "@/lib/services/appointments";

type Ctx = { params: Promise<{ tenantId: string; serviceId: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  try {
    const { tenantId, serviceId } = await params;
    await requireTenantAccess(tenantId);
    return ok({ schema: await getServiceSchema(tenantId, serviceId) });
  } catch (e) {
    return handleError(e);
  }
}

export async function PATCH(request: Request, { params }: Ctx) {
  try {
    const { tenantId, serviceId } = await params;
    await requireTenantAccess(tenantId);
    const body = (await request.json()) as { fields?: unknown[] };
    if (!Array.isArray(body.fields)) {
      throw new HttpError(400, "fields array is required");
    }
    return ok({ schema: await updateServiceSchema(tenantId, serviceId, body.fields) });
  } catch (e) {
    return handleError(e);
  }
}
