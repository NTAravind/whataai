import { supabaseAdmin, unwrap } from "@/lib/clients/supabase";
import { AgentToolError } from "@/lib/agents/errors";
import { findReminderTemplate, buildReminderTemplateContent } from "@/lib/services/templates";

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
    if (clash) throw new AgentToolError("That time slot is no longer available");
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

export async function getBooking(tenantId: string, bookingId: string) {
  const { data, error } = await supabaseAdmin()
    .from("bookings")
    .select(
      "id, tenant_id, business_id, service_id, resource_id, customer_id, conversation_id, start_time, end_time, status, booking_data, business:businesses(name, timezone), service:services(name), resource:resources(name), customer:contacts(id, full_name, phone_number)",
    )
    .eq("id", bookingId)
    .eq("tenant_id", tenantId)
    .single();

  if (error) throw error;
  return data;
}

export async function cancelBooking(tenantId: string, bookingId: string, reason?: string) {
  const admin = supabaseAdmin();
  const { data, error } = await admin
    .from("bookings")
    .update({
      status: "cancelled",
      metadata: {
        cancelled_at: new Date().toISOString(),
        cancel_reason: reason ?? "Requested by customer/user",
      },
      updated_at: new Date().toISOString(),
    })
    .eq("id", bookingId)
    .eq("tenant_id", tenantId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function scheduleBookingReminder(
  tenantId: string,
  bookingId: string,
  hoursBefore: number = 24,
) {
  const { scheduleMessage } = await import("@/lib/services/scheduling");
  const admin = supabaseAdmin();
  const { data: bookingData, error: bErr } = await admin
    .from("bookings")
    .select(
      "id, start_time, customer_id, conversation_id, service:services(name), customer:contacts(id, phone_number, full_name)",
    )
    .eq("id", bookingId)
    .eq("tenant_id", tenantId)
    .single();

  if (bErr || !bookingData) throw bErr ?? new Error("Booking not found");

  const booking = (bookingData as unknown) as {
    id: string;
    start_time: string;
    customer_id: string | null;
    conversation_id: string | null;
    service?: { name: string } | { name: string }[] | null;
    customer?: { id: string; phone_number: string | null; full_name: string | null } | { id: string; phone_number: string | null; full_name: string | null }[] | null;
  };

  if (!booking.customer_id) {
    throw new Error("Cannot send reminder: No contact attached to this booking");
  }

  const { data: waAcc } = await admin
    .from("wa_accounts")
    .select("id")
    .eq("tenant_id", tenantId)
    .limit(1)
    .maybeSingle();

  if (!waAcc) throw new Error("No active WhatsApp account configured for sending reminders");

  const startTimeMs = new Date(booking.start_time).getTime();
  const sendAtMs = hoursBefore > 0 ? startTimeMs - hoursBefore * 3600 * 1000 : Date.now();
  const sendAtISO = new Date(Math.max(sendAtMs, Date.now() + 5000)).toISOString();

  const formattedDate = new Date(booking.start_time).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });

  const serviceObj = Array.isArray(booking.service) ? booking.service[0] : booking.service;
  const customerObj = Array.isArray(booking.customer) ? booking.customer[0] : booking.customer;

  const serviceName = serviceObj?.name ?? "Appointment";
  const fullName = customerObj?.full_name?.trim() ?? "";
  const customerName = fullName ? `, ${fullName}` : "";
  const firstName = fullName ? fullName.split(/\s+/)[0] : "";
  const reminderText = `Reminder${customerName}: Your ${serviceName} booking is scheduled for ${formattedDate}. Please let us know if you need to reschedule or cancel!`;

  // Prefer an approved "reminder" template when one exists; fall back to the
  // plain-text reminder otherwise.
  const reminderTemplate = await findReminderTemplate(tenantId, waAcc.id);
  const templatePayload = reminderTemplate
    ? buildReminderTemplateContent(reminderTemplate, {
        customerName: firstName,
        serviceName,
        dateLabel: formattedDate,
      })
    : null;

  const content = templatePayload
    ? templatePayload.content
    : ({ type: "text", text: reminderText } as const);

  return scheduleMessage({
    tenantId,
    channel: "whatsapp",
    channelAccountId: waAcc.id,
    contactId: booking.customer_id,
    conversationId: booking.conversation_id ?? undefined,
    sendAt: sendAtISO,
    content,
    ...(templatePayload ? { templateId: templatePayload.templateId } : {}),
  });
}

