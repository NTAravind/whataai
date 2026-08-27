import { requireTenantAccess } from "@/lib/auth/guard";
import { created, handleError, HttpError, ok } from "@/lib/http";
import { createBooking, listBookings } from "@/lib/services/bookings";

type Ctx = { params: Promise<{ tenantId: string }> };

export async function GET(request: Request, { params }: Ctx) {
  try {
    const { tenantId } = await params;
    await requireTenantAccess(tenantId);
    const url = new URL(request.url);
    return ok({
      bookings: await listBookings(
        tenantId,
        url.searchParams.get("from") ?? undefined,
        url.searchParams.get("to") ?? undefined,
      ),
    });
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
      serviceId?: string;
      serviceSchemaId?: string | null;
      resourceId?: string | null;
      customerId?: string | null;
      conversationId?: string | null;
      startTime?: string;
      endTime?: string;
      timezone?: string;
      bookingData?: Record<string, unknown>;
    };

    if (!body.businessId) throw new HttpError(400, "businessId is required");
    if (!body.serviceId) throw new HttpError(400, "serviceId is required");
    if (!body.startTime) throw new HttpError(400, "startTime is required");
    if (!body.endTime) throw new HttpError(400, "endTime is required");

    const booking = await createBooking({
      tenantId,
      businessId: body.businessId,
      serviceId: body.serviceId,
      serviceSchemaId: body.serviceSchemaId,
      resourceId: body.resourceId,
      customerId: body.customerId,
      conversationId: body.conversationId,
      startTime: body.startTime,
      endTime: body.endTime,
      timezone: body.timezone,
      bookingData: body.bookingData,
    });

    return created({ booking });
  } catch (e) {
    return handleError(e);
  }
}

