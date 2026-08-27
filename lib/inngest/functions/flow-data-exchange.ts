import { inngest } from "@/lib/clients/ingest";
import { flowDataExchange } from "@/lib/inngest/events";
import { supabaseAdmin } from "@/lib/clients/supabase";
import { createBooking } from "@/lib/services/bookings";

/**
 * WhatsApp Flow state machine (docs/guide.md §7 — `flow.data.exchange`).
 *
 * The encrypted HTTP round-trip is answered synchronously by the Flows route;
 * this function is the durable journal that commits each state transition to
 * `flow_sessions` and executes the completion side-effects (booking creation).
 * Because every transition is journaled, the route can always answer a
 * re-fetch (or BACK) from the last committed screen even if a previous run
 * crashed.
 */
export const flowDataExchangeHandler = inngest.createFunction(
  {
    id: "flow-data-exchange",
    name: "WhatsApp Flow Data Exchange",
    triggers: [flowDataExchange],
    retries: 3,
  },
  async ({ event, step }) => {
    const d = event.data;

    const session = await step.run("load-session", async () => {
      const { data, error } = await supabaseAdmin()
        .from("flow_sessions")
        .select(
          "id, tenant_id, flow_id, current_screen, collected_data, screen_history, status, booking_id, business_id, conversation_id",
        )
        .eq("flow_token", d.flowToken)
        .single();
      if (error) throw error;
      return data;
    });

    if (session.status === "completed" && session.booking_id) {
      return { action: d.action, skipped: true, reason: "session_completed" };
    }

    // ping / error / BACK are state transitions but never create bookings.
    if (d.action === "ping" || d.action === "error") {
      return { action: d.action, ack: true };
    }

    if (d.action === "BACK") {
      const history = (session.screen_history as string[]) ?? [];
      const previous = history.length > 1 ? history[history.length - 2] : session.current_screen;
      await step.run("journal-back", async () => {
        await supabaseAdmin()
          .from("flow_sessions")
          .update({
            current_screen: previous,
            screen_history: history.slice(0, -1),
            status: "open",
          })
          .eq("id", session.id);
      });
      return { action: "BACK", screen: previous };
    }

    // INIT or data_exchange: commit the incoming data onto the session.
    const merged = await step.run("merge-data", async () => {
      const previous = (session.collected_data as Record<string, unknown>) ?? {};
      const incoming = (d.data as Record<string, unknown>) ?? {};
      const mergedData = { ...previous, ...incoming };
      const history = [...((session.screen_history as string[]) ?? [])];
      if (session.current_screen) history.push(session.current_screen);
      return { mergedData, history, nextScreen: d.screen ?? "done" };
    });

    await step.run("journal-transition", async () => {
      const { error } = await supabaseAdmin()
        .from("flow_sessions")
        .update({
          current_screen: merged.nextScreen,
          collected_data: merged.mergedData,
          screen_history: merged.history,
          status: merged.nextScreen === "done" ? "completed" : "open",
        })
        .eq("id", session.id);
      if (error) throw error;
    });

    // Completion side effect: create the confirmed booking from collected data.
    if (merged.nextScreen === "done" && d.action === "data_exchange") {
      const booking = await step.run("create-booking", async () => {
        const data = merged.mergedData as {
          date?: string;
          time?: string;
          service_name?: string;
        };
        const { data: flow } = await supabaseAdmin()
          .from("flows")
          .select("id, service_id")
          .eq("id", session.flow_id)
          .single();

        if (!session.business_id || !data.date || !data.time) return null;

        const { data: business } = await supabaseAdmin()
          .from("businesses")
          .select("id, timezone")
          .eq("id", session.business_id)
          .single();
        const timezone = business?.timezone ?? "UTC";
        const start = new Date(`${data.date}T${data.time}:00Z`);
        if (Number.isNaN(start.getTime())) return null;

        const booking = await createBooking({
          tenantId: session.tenant_id,
          businessId: session.business_id,
          serviceId: flow?.service_id ?? "",
          serviceSchemaId: null,
          customerId: null,
          conversationId: session.conversation_id ?? null,
          startTime: start.toISOString(),
          endTime: new Date(start.getTime() + 30 * 60_000).toISOString(),
          timezone,
          bookingData: data,
        });
        return booking;
      });

      if (booking) {
        await step.run("link-booking", async () => {
          await supabaseAdmin()
            .from("flow_sessions")
            .update({ booking_id: booking.id, status: "completed" })
            .eq("id", session.id);
        });
        return { action: d.action, bookingId: booking.id };
      }
    }

    return { action: d.action, screen: merged.nextScreen };
  },
);
