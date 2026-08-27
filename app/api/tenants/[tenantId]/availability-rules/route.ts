import { requireTenantAccess } from "@/lib/auth/guard";
import { created, handleError, HttpError, ok } from "@/lib/http";
import { createAvailabilityRule, listAvailabilityRules } from "@/lib/services/appointments";

type Ctx = { params: Promise<{ tenantId: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  try {
    const { tenantId } = await params;
    await requireTenantAccess(tenantId);
    return ok({ rules: await listAvailabilityRules(tenantId) });
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
      resourceId?: string | null;
      dayOfWeek?: number;
      startTime?: string;
      endTime?: string;
      timezone?: string;
    };
    if (!body.businessId) throw new HttpError(400, "businessId is required");
    if (body.dayOfWeek === undefined) throw new HttpError(400, "dayOfWeek is required");
    if (!body.startTime || !body.endTime) throw new HttpError(400, "startTime and endTime are required");
    return created({
      rule: await createAvailabilityRule({
        tenantId,
        businessId: body.businessId,
        resourceId: body.resourceId,
        dayOfWeek: body.dayOfWeek,
        startTime: body.startTime,
        endTime: body.endTime,
        timezone: body.timezone,
      }),
    });
  } catch (e) {
    return handleError(e);
  }
}
