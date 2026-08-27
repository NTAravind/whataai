import { requireTenantAccess } from "@/lib/auth/guard";
import { handleError, HttpError, ok } from "@/lib/http";
import { cancelBooking, getBooking, scheduleBookingReminder } from "@/lib/services/bookings";

type Ctx = { params: Promise<{ tenantId: string; bookingId: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  try {
    const { tenantId, bookingId } = await params;
    await requireTenantAccess(tenantId);
    return ok({ booking: await getBooking(tenantId, bookingId) });
  } catch (e) {
    return handleError(e);
  }
}

export async function PATCH(request: Request, { params }: Ctx) {
  try {
    const { tenantId, bookingId } = await params;
    await requireTenantAccess(tenantId);
    const body = (await request.json()) as {
      action?: "cancel" | "reminder";
      reason?: string;
      hoursBefore?: number;
    };

    if (body.action === "cancel") {
      const cancelled = await cancelBooking(tenantId, bookingId, body.reason);
      return ok({ booking: cancelled, message: "Booking cancelled successfully" });
    }

    if (body.action === "reminder") {
      const scheduled = await scheduleBookingReminder(tenantId, bookingId, body.hoursBefore ?? 24);
      return ok({ scheduled, message: "Appointment reminder scheduled" });
    }

    throw new HttpError(400, "Invalid action. Supported actions: 'cancel', 'reminder'");
  } catch (e) {
    return handleError(e);
  }
}
