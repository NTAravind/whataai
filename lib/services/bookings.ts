import { supabaseAdmin, unwrap } from "@/lib/clients/supabase";

export interface CreateBookingInput {
  tenantId: string;
  businessId: string;
  serviceId: string;
  serviceSchemaId?: string | null;
  resourceId?: string | null;
  customerId?: string | null;
  conversationId?: string | null;
  startTime: string;
  endTime: string;
  timezone?: string;
  bookingData?: Record<string, unknown>;
}

/** Insert a booking, refusing if it conflicts with an existing one. */
export async function createBooking(input: CreateBookingInput) {
  const admin = supabaseAdmin();

  if (input.resourceId) {
    const { data: clash } = await admin
      .from("bookings")
      .select("id")
      .eq("resource_id", input.resourceId)
      .in("status", ["pending", "confirmed"])
      .lt("start_time", input.endTime)
      .gt("end_time", input.startTime)
      .limit(1)
      .maybeSingle();
    if (clash) throw new Error("That time slot is no longer available");
  }

  const { data, error } = await admin
    .from("bookings")
    .insert({
      tenant_id: input.tenantId,
      business_id: input.businessId,
      service_id: input.serviceId,
      service_schema_id: input.serviceSchemaId ?? null,
      resource_id: input.resourceId ?? null,
      customer_id: input.customerId ?? null,
      conversation_id: input.conversationId ?? null,
      start_time: input.startTime,
      end_time: input.endTime,
      timezone: input.timezone ?? "UTC",
      status: "confirmed",
      booking_data: input.bookingData ?? {},
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function listBookings(tenantId: string, from?: string, to?: string) {
  let query = supabaseAdmin()
    .from("bookings")
    .select(
      "id, start_time, end_time, status, booking_data, business:businesses(name), service:services(name), resource:resources(name), customer:contacts(full_name, phone_number)",
    )
    .eq("tenant_id", tenantId)
    .order("start_time", { ascending: false });
  if (from) query = query.gte("start_time", from);
  if (to) query = query.lte("start_time", to);
  return unwrap(await query);
}
