import { inngest } from "@/lib/clients/ingest";
import { cron } from "inngest";
import { supabaseAdmin } from "@/lib/clients/supabase";
import { messageOutboundSend } from "@/lib/inngest/events";
import { findReminderTemplate, buildReminderTemplateContent } from "@/lib/services/templates";

/**
 * Booking reminders (docs/api-guide.md — appointment flows, next day).
 *
 * Daily scan: for every confirmed booking starting in ~24-30h that hasn't
 * had a reminder yet, re-emit a durable WhatsApp/mail outbound send. Guarded
 * by bookings.reminder_sent_at so retries can't double-notify. WhatsApp
 * reminders use an approved "reminder" template when one exists, falling
 * back to plain text (mail always uses plain text).
 */
export const bookingReminder = inngest.createFunction(
  {
    id: "booking-reminder",
    name: "Booking Reminder",
    triggers: [cron("TZ=Etc/UTC 0 8 * * *")],
    retries: 2,
  },
  async ({ step, logger }) => {
    const now = Date.now();
    const windowStart = new Date(now + 22 * 60 * 60 * 1000).toISOString();
    const windowEnd = new Date(now + 30 * 60 * 60 * 1000).toISOString();

    const due = await step.run("find-due-bookings", async () => {
      const { data, error } = await supabaseAdmin()
        .from("bookings")
        .select(
          "id, tenant_id, start_time, contact:contacts(id, phone_number, email, full_name), service:services(name)",
        )
        .eq("status", "confirmed")
        .is("reminder_sent_at", null)
        .gte("start_time", windowStart)
        .lte("start_time", windowEnd);
      if (error) throw error;
      return data ?? [];
    });

    let reminded = 0;
    for (const booking of due) {
      const contact = booking.contact as unknown as
        | { id: string; phone_number: string | null; email: string | null; full_name: string | null }
        | null;
      if (!contact) continue;

      const dateLabel = new Date(booking.start_time).toLocaleString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });

      const waAccount = await step.run(`wa-account-${booking.id}`, async () => {
        const { data } = await supabaseAdmin()
          .from("conversations")
          .select("wa_account_id, mail_account_id")
          .eq("contact_id", contact.id)
          .order("last_message_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        return data ?? null;
      });

      const channel: "whatsapp" | "mail" =
        waAccount?.wa_account_id ? "whatsapp" : "mail";
      const channelAccountId =
        channel === "whatsapp" ? waAccount?.wa_account_id : waAccount?.mail_account_id;
      const senderId =
        channel === "whatsapp" ? contact.phone_number : contact.email;
      if (!channelAccountId || !senderId) continue;

      const service = booking.service as unknown as
        | { name: string }
        | { name: string }[]
        | null;
      const serviceObj = Array.isArray(service) ? service[0] : service;
      const serviceName = serviceObj?.name ?? "your appointment";
      const firstName = contact.full_name?.trim().split(/\s+/)[0] ?? "";
      const fallbackText = `Reminder: you have a booking on ${dateLabel}. Reply if you need to reschedule.`;

      // Prefer an approved "reminder" template for WhatsApp; mail reminders
      // fall back to plain text (mail has no templates).
      let templatePayload: Awaited<ReturnType<typeof buildReminderTemplateContent>> = null;
      if (channel === "whatsapp") {
        templatePayload = await step.run(`resolve-reminder-template-${booking.id}`, async () => {
          const tpl = await findReminderTemplate(booking.tenant_id, channelAccountId);
          return tpl
            ? buildReminderTemplateContent(tpl, {
                customerName: firstName,
                serviceName,
                dateLabel,
              })
            : null;
        });
      }

      const content = templatePayload
        ? templatePayload.content
        : ({ type: "text", text: fallbackText } as const);

      const messageId = await step.run(`insert-reminder-message-${booking.id}`, async () => {
        const { data, error } = await supabaseAdmin()
          .from("messages")
          .insert({
            conversation_id: null,
            role: "assistant",
            content: content as unknown as Record<string, unknown>,
            status: "queued",
          })
          .select()
          .single();
        if (error) throw error;
        return data.id;
      });

      await step.sendEvent(`emit-reminder-${booking.id}`, {
        name: messageOutboundSend.name,
        data: {
          tenantId: booking.tenant_id,
          channel,
          channelAccountId,
          contactId: contact.id,
          senderId,
          content,
          ...(templatePayload ? { templateId: templatePayload.templateId } : {}),
          messageId,
        },
      });

      await step.run(`mark-reminded-${booking.id}`, () =>
        supabaseAdmin()
          .from("bookings")
          .update({ reminder_sent_at: new Date().toISOString() })
          .eq("id", booking.id),
      );

      reminded++;
    }

    logger.info("booking reminders dispatched", { due: due.length, reminded });
    return { due: due.length, reminded };
  },
);
