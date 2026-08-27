import { requireTenantAccess } from "@/lib/auth/guard";
import { handleError, ok } from "@/lib/http";
import { deleteAppointmentService, listAppointmentServices, updateAppointmentService } from "@/lib/services/appointments";

type Ctx = { params: Promise<{ tenantId: string; serviceId: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  try {
    const { tenantId, serviceId } = await params;
    await requireTenantAccess(tenantId);
    const services = await listAppointmentServices(tenantId);
    const service = services.find((s) => s.id === serviceId);
    if (!service) return handleError(new Error("Service not found"));
    return ok({ service });
  } catch (e) {
    return handleError(e);
  }
}

export async function PATCH(request: Request, { params }: Ctx) {
  try {
    const { tenantId, serviceId } = await params;
    await requireTenantAccess(tenantId);
    const body = (await request.json()) as {
      name?: string;
      description?: string | null;
      bookingMode?: string;
      defaultDurationMinutes?: number | null;
      requiresResourceType?: string | null;
      enabled?: boolean;
    };
    return ok({ service: await updateAppointmentService(tenantId, serviceId, body) });
  } catch (e) {
    return handleError(e);
  }
}

export async function DELETE(_request: Request, { params }: Ctx) {
  try {
    const { tenantId, serviceId } = await params;
    await requireTenantAccess(tenantId);
    await deleteAppointmentService(tenantId, serviceId);
    return ok({ success: true });
  } catch (e) {
    return handleError(e);
  }
}

