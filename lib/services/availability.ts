import { supabaseAdmin, unwrap } from "@/lib/clients/supabase";

/**
 * Availability engine for the booking tools. Pure computation over
 * availability_rules / availability_exceptions / bookings — no writes.
 */

export interface Slot {
  resourceId: string | null;
  resourceName: string | null;
  start: string; // ISO
  end: string;
}

export interface CheckAvailabilityInput {
  tenantId: string;
  businessId: string;
  serviceId: string;
  /** YYYY-MM-DD .. YYYY-MM-DD (inclusive) */
  from: string;
  to: string;
  durationMinutes?: number;
}

export async function checkAvailability(input: CheckAvailabilityInput) {
  const admin = supabaseAdmin();

  const service = unwrap<{ default_duration_minutes: number | null }>(
    await admin.from("services").select("*").eq("id", input.serviceId).eq("enabled", true).single(),
  );
  const duration = input.durationMinutes ?? service.default_duration_minutes ?? 30;

  const { data: rules } = await admin
    .from("availability_rules")
    .select("*")
    .eq("business_id", input.businessId);

  const { data: exceptions } = await admin
    .from("availability_exceptions")
    .select("*")
    .eq("business_id", input.businessId)
    .gte("date", input.from)
    .lte("date", input.to);

  const { data: bookings } = await admin
    .from("bookings")
    .select("resource_id, start_time, end_time")
    .eq("tenant_id", input.tenantId)
    .in("status", ["pending", "confirmed"])
    .gte("start_time", `${input.from}T00:00:00Z`)
    .lt("start_time", `${input.to}T23:59:59Z`);

  const slots: Slot[] = [];

  // Walk each day in range.
  const fromDate = new Date(`${input.from}T00:00:00Z`);
  const toDate = new Date(`${input.to}T00:00:00Z`);
  const day = new Date(fromDate);

  while (day <= toDate) {
    const dateStr = day.toISOString().slice(0, 10);
    const dow = day.getUTCDay();
    const dayExceptions = (exceptions ?? []).filter((e: { date: string }) => e.date === dateStr);

    const applicableRules = (rules ?? []).filter((r: { day_of_week: number; resource_id: string | null }) => r.day_of_week === dow);

    for (const rule of applicableRules) {
      // Whole-day closure overrides this rule.
      const closed = dayExceptions.some((e: { is_closed: boolean; start_time: string | null }) => e.is_closed && !e.start_time);
      if (closed) continue;

      const resourceId = rule.resource_id as string | null;
      const resourceName = resourceId ? await resourceNameById(resourceId) : "Any resource";

      // Build candidate slots at rule granularity.
      let cursor = parseTime(rule.start_time, dateStr);
      const end = parseTime(rule.end_time, dateStr);
      const stepMs = Math.max(15 * 60 * 1000, duration * 60 * 1000);

      while (cursor.getTime() + duration * 60 * 1000 <= end.getTime()) {
        const slotStart = cursor.toISOString();
        const slotEnd = new Date(cursor.getTime() + duration * 60 * 1000).toISOString();

        // Skip slots inside a time-window exception.
        const blocked = dayExceptions.some((e: { start_time: string | null; end_time: string | null }) => {
          if (!e.start_time) return false;
          const exStart = parseTime(e.start_time, dateStr).getTime();
          const exEnd = e.end_time ? parseTime(e.end_time, dateStr).getTime() : Number.MAX_SAFE_INTEGER;
          return cursor.getTime() < exEnd && cursor.getTime() + duration * 60 * 1000 > exStart;
        });

        const conflict = (bookings ?? []).some(
          (b: { resource_id: string | null; start_time: string; end_time: string }) => {
            if (resourceId !== null && b.resource_id !== resourceId) return false;
            return new Date(b.start_time).getTime() < cursor.getTime() + duration * 60 * 1000 &&
              new Date(b.end_time ?? b.start_time).getTime() > cursor.getTime();
          },
        );

        if (!blocked && !conflict) {
          slots.push({ resourceId, resourceName, start: slotStart, end: slotEnd });
        }
        cursor = new Date(cursor.getTime() + stepMs);
      }
    }

    day.setUTCDate(day.getUTCDate() + 1);
  }

  return slots;
}

function parseTime(timeStr: string, dateStr: string): Date {
  const [h, m] = timeStr.split(":").map(Number);
  return new Date(Date.UTC(
    Number(dateStr.slice(0, 4)),
    Number(dateStr.slice(5, 7)) - 1,
    Number(dateStr.slice(8, 10)),
    h,
    m,
  ));
}

async function resourceNameById(resourceId: string): Promise<string | null> {
  const { data } = await supabaseAdmin()
    .from("resources")
    .select("name")
    .eq("id", resourceId)
    .maybeSingle();
  return data?.name ?? null;
}
