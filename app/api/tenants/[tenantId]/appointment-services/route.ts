import { requireTenantAccess } from "@/lib/auth/guard";
import { created, handleError, HttpError, ok } from "@/lib/http";
import { createAppointmentService, listAppointmentServices } from "@/lib/services/appointments";

type Ctx = { params: Promise<{ tenantId: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  try {
    const { tenantId } = await params;
    await requireTenantAccess(tenantId);
    return ok({ services: await listAppointmentServices(tenantId) });
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
      description?: string | null;
      bookingMode?: string;
      defaultDurationMinutes?: number | null;
      requiresResourceType?: string | null;
    };
    if (!body.businessId) throw new HttpError(400, "businessId is required");
    if (!body.name?.trim()) throw new HttpError(400, "name is required");
    return created({
      service: await createAppointmentService({
        tenantId,
        businessId: body.businessId,
        name: body.name.trim(),
        description: body.description,
        bookingMode: body.bookingMode,
        defaultDurationMinutes: body.defaultDurationMinutes,
        requiresResourceType: body.requiresResourceType,
      }),
    });
  } catch (e) {
    return handleError(e);
  }
}
