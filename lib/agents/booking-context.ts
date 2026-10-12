import { supabaseAdmin } from "@/lib/clients/supabase";

export interface BookingContext {
  lastToolCallAt?: string;
  lastToolName?: string;
  lastToolArgs?: Record<string, unknown>;
  bookingDraft?: Record<string, unknown>;
  dateConfirmed?: string;
  updatedAt?: string;
}

export async function loadBookingContext(conversationId: string): Promise<BookingContext> {
  const admin = supabaseAdmin();
  const { data } = await admin
    .from("conversations")
    .select("booking_context")
    .eq("id", conversationId)
    .maybeSingle();
  return (data?.booking_context ?? {}) as BookingContext;
}

export async function saveBookingContext(conversationId: string, ctx: BookingContext): Promise<void> {
  const admin = supabaseAdmin();
  await admin
    .from("conversations")
    .update({ booking_context: { ...ctx, updatedAt: new Date().toISOString() } })
    .eq("id", conversationId);
}

export function shouldIgnoreBookingContext(text: string, ctx: BookingContext): boolean {
  const t = text?.toLowerCase() ?? "";
  if (/reset|start over|new booking|clear/.test(t)) return true;
  const last = ctx.lastToolCallAt ? Date.parse(ctx.lastToolCallAt) : 0;
  if (last && Date.now() - last > 30 * 60 * 1000) return true;
  return false;
}
