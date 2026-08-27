import type { FlexibleSchema, ToolSet } from "ai";
import { z } from "zod";
import { searchKnowledgeBase } from "@/lib/services/kb";
import { checkAvailability } from "@/lib/services/availability";
import { cancelBooking, createBooking } from "@/lib/services/bookings";
import { scheduleBookingReminder } from "@/lib/services/bookings";
import { supabaseAdmin } from "@/lib/clients/supabase";
import { createTemplate } from "@/lib/services/templates";
import { setConversationStatus } from "@/lib/services/conversations";
import { enqueueOutboundMessage } from "@/lib/services/messages";
import { rejectPastDate } from "./date-validation";

/**
 * Tool registry (docs/guide.md §5). Each tool is defined once with a Zod
 * schema; `agent_tools` rows just toggle which tools an agent sees. Adding a
 * new capability = add one entry here + one `agent_tools` row, no deploys.
 */

export interface AgentToolCtx {
  tenantId: string;
  conversationId?: string;
  contactId?: string;
  customerName?: string | null;
}

export type ToolDef = {
  description: string;
  parameters: z.ZodTypeAny;
  execute: (ctx: AgentToolCtx, args: unknown) => Promise<string>;
};

export const tools: Record<string, ToolDef> = {
  search_knowledge_base: {
    description:
      "Search the business's knowledge base for answers to a customer question. Use this before answering anything factual about the business (pricing, hours, policies, location).",
    parameters: z.object({
      query: z.string().describe("Concise search query, e.g. 'opening hours'"),
    }),
    execute: async (ctx, args) => {
      const { query } = args as { query: string };
      const results = await searchKnowledgeBase(ctx.tenantId, query);
      if (!results.length) return "No relevant knowledge base articles found. Do not invent an answer — apologize and offer to escalate.";
      return results
        .map((r, i) => `[${i + 1}] ${r.content}`)
        .join("\n\n---\n\n");
    },
  },

  check_availability: {
    description:
      "Check open booking slots and available staff/resources for a date. Call before suggesting times or confirming a booking. Lists available times for each staff member or resource.",
    parameters: z.object({
      date: z.string().describe("Date to check, YYYY-MM-DD"),
      resource_name: z.string().optional().describe("Optional staff, doctor, room, or resource name to filter by"),
      service_name: z.string().optional().describe("Optional service name"),
      duration_minutes: z.number().optional().describe("Optional requested duration in minutes"),
    }),
    execute: async (ctx, args) => {
      const { date, resource_name, service_name, duration_minutes } = args as {
        date: string;
        resource_name?: string;
        service_name?: string;
        duration_minutes?: number;
      };
      rejectPastDate(`${date}T00:00:00Z`, "date");
      const business = await defaultBusiness(ctx.tenantId);
      if (!business) return "No business is configured for this workspace. Escalate to a human.";
      const service = service_name ? await serviceByName(business.id, service_name) : await defaultService(business.id);
      if (!service) return "No bookable service configured. Escalate to a human.";

      let slots = await checkAvailability({
        tenantId: ctx.tenantId,
        businessId: business.id,
        serviceId: service.id,
        from: date,
        to: date,
        durationMinutes: duration_minutes,
      });

      if (resource_name) {
        const norm = resource_name.trim().toLowerCase();
        slots = slots.filter((s) => s.resourceName && s.resourceName.toLowerCase().includes(norm));
      }

      if (!slots.length) {
        return resource_name
          ? `No slots available for ${resource_name} on ${date}. Ask if customer wants another staff member/resource or another date.`
          : `No slots available on ${date}. Offer the next available day.`;
      }
      const byResource = groupBy(slots, (s) => s.resourceName ?? "Any");
      return Object.entries(byResource)
        .map(([name, slotList]) => `${name}: ${slotList.map((s) => s.start.slice(11, 16)).join(", ")}`)
        .join("\n");
    },
  },

  create_booking: {
    description:
      "Create a confirmed booking for the customer at a specific date, time, and assigned resource/staff member. Only call this AFTER the customer has agreed to the slot and resource.",
    parameters: z.object({
      date: z.string().describe("Date of the booking, YYYY-MM-DD"),
      time: z.string().describe("Start time of the booking, 24h HH:MM"),
      service_name: z.string().optional().describe("Optional service name"),
      resource_name: z.string().optional().describe("Optional staff member, doctor, room, or resource name requested by customer"),
      customer_name: z.string().optional().describe("Optional customer full name"),
      notes: z.string().optional().describe("Optional special requests or notes"),
    }),
    execute: async (ctx, args) => {
      const { date, time, service_name, resource_name, customer_name, notes } = args as {
        date: string;
        time: string;
        service_name?: string;
        resource_name?: string;
        customer_name?: string;
        notes?: string;
      };
      const business = await defaultBusiness(ctx.tenantId);
      if (!business) return "No business configured. Cannot book. Escalate to a human.";
      const service = service_name ? await serviceByName(business.id, service_name) : await defaultService(business.id);
      if (!service) return "Service not found. Cannot book. Escalate to a human.";

      let resourceId: string | null = null;
      if (resource_name) {
        const res = await resourceByName(business.id, resource_name);
        if (res) resourceId = res.id;
      }

      const start = new Date(`${date}T${time}:00Z`);
      if (Number.isNaN(start.getTime())) return "Invalid date/time provided.";
      rejectPastDate(start.toISOString(), "booking date");

      const nameToUse = customer_name ?? ctx.customerName ?? null;

      const booking = await createBooking({
        tenantId: ctx.tenantId,
        businessId: business.id,
        serviceId: service.id,
        serviceSchemaId: service.active_schema_id,
        resourceId,
        customerId: ctx.contactId,
        conversationId: ctx.conversationId,
        startTime: start.toISOString(),
        endTime: new Date(start.getTime() + (service.default_duration_minutes ?? 30) * 60_000).toISOString(),
        timezone: business.timezone ?? "UTC",
        bookingData: {
          customer_name: nameToUse,
          resource_name: resource_name ?? null,
          notes: notes ?? null,
        },
      });

      const resLabel = resource_name ? ` with ${resource_name}` : "";
      return `Booking confirmed (id ${booking.id}) for ${service.name}${resLabel} on ${date} at ${time}.`;
    },
  },

  cancel_booking: {
    description:
      "Cancel an existing booking for the customer. Call when the customer requests to cancel their appointment or reservation.",
    parameters: z.object({
      date: z.string().optional().describe("Optional date of booking to cancel, YYYY-MM-DD"),
      reason: z.string().optional().describe("Optional reason for cancellation"),
    }),
    execute: async (ctx, args) => {
      const { date, reason } = args as { date?: string; reason?: string };
      const admin = supabaseAdmin();
      let query = admin
        .from("bookings")
        .select("id, start_time, service:services(name)")
        .eq("tenant_id", ctx.tenantId)
        .in("status", ["pending", "confirmed"])
        .order("start_time", { ascending: true });

      if (ctx.contactId) query = query.eq("customer_id", ctx.contactId);
      if (date) query = query.gte("start_time", `${date}T00:00:00Z`).lt("start_time", `${date}T23:59:59Z`);

      const { data, error } = await query.limit(1).maybeSingle();
      if (error || !data) {
        return "No active booking found to cancel for this customer. Inform the customer or offer to check with a human agent.";
      }

      const booking = (data as unknown) as { id: string; start_time: string; service?: { name: string } | { name: string }[] | null };
      await cancelBooking(ctx.tenantId, booking.id, reason);

      const serviceObj = Array.isArray(booking.service) ? booking.service[0] : booking.service;
      const serviceName = serviceObj?.name ?? "booking";
      const formattedDate = new Date(booking.start_time).toLocaleString("en-US", {
        dateStyle: "medium",
        timeStyle: "short",
      });

      return `Your ${serviceName} booking on ${formattedDate} has been successfully cancelled.`;
    },
  },

  schedule_reminder: {
    description:
      "Schedule a WhatsApp reminder for a booking. Call immediately after create_booking with the booking ID from its result. Sends a message to the customer hours before their appointment.",
    parameters: z.object({
      booking_id: z.string().describe("ID of the confirmed booking (from create_booking result)"),
      hours_before: z.number().optional().default(24).describe("Hours before the appointment to send the reminder (default 24)"),
    }),
    execute: async (ctx, args) => {
      const { booking_id, hours_before } = args as { booking_id: string; hours_before?: number };
      try {
        await scheduleBookingReminder(ctx.tenantId, booking_id, hours_before ?? 24);
        return `Reminder scheduled for ${hours_before ?? 24} hours before the appointment.`;
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        return `Could not schedule reminder: ${detail}. The booking is still confirmed — the customer can reply to this conversation to get details.`;
      }
    },
  },

  list_resources: {
    description:
      "List all available resources, staff members, doctors, rooms, or equipment for the business. Call when a customer asks who or what is available to book.",
    parameters: z.object({}),
    execute: async (ctx) => {
      const business = await defaultBusiness(ctx.tenantId);
      if (!business) return "No business configured.";
      const { data } = await supabaseAdmin()
        .from("resources")
        .select("name, type")
        .eq("business_id", business.id)
        .eq("enabled", true);
      const list = (data as { name: string; type: string }[]) ?? [];
      if (!list.length) return "No specific staff members or resources configured. Bookings apply to the business as a whole.";
      return list.map((r) => `- ${r.name} (${r.type})`).join("\n");
    },
  },

  escalate_to_human: {
    description:
      "Escalate the conversation to a human agent. Use when you cannot answer, the customer asks for a person, or the request is outside your capabilities.",
    parameters: z.object({
      reason: z.string().describe("Short reason for escalation"),
    }),
    execute: async (ctx, args) => {
      const { reason } = args as { reason: string };
      if (ctx.conversationId) {
        await setConversationStatus(ctx.conversationId, "needs_human");
        await supabaseAdmin()
          .from("conversations")
          .update({ metadata: { escalated_reason: reason } })
          .eq("id", ctx.conversationId);
      }
      return "Escalated. Tell the customer a human agent will follow up shortly.";
    },
  },

  list_templates: {
    description:
      "List the approved WhatsApp message templates this business can send to a customer (name, category, language). Call before send_template to see what's available.",
    parameters: z.object({
      category: z.string().optional().describe("Optional filter: MARKETING, UTILITY or AUTHENTICATION"),
    }),
    execute: async (ctx, args) => {
      const { category } = args as { category?: string };
      const { data, error } = await supabaseAdmin()
        .from("whatsapp_templates")
        .select("name, language, category, components")
        .eq("tenant_id", ctx.tenantId)
        .eq("status", "approved")
        .order("name", { ascending: true });
      if (error) return "Templates are temporarily unavailable. Escalate to a human.";
      type TemplateRecord = { name: string; language: string; category: string; components?: Record<string, unknown>[] };
      const templates = (data as TemplateRecord[] ?? []).filter(
        (t) => !category || t.category === category,
      );
      if (!templates.length) return "No approved templates are available for this business.";
      return templates.map((t) => {
        const bodyComp = (t.components ?? []).find((c) => (c as Record<string, unknown>).type === "BODY") as Record<string, unknown> | undefined;
        const exampleLabels = (bodyComp?.example as Record<string, unknown> | undefined)?.body_text;
        const labels = Array.isArray(exampleLabels) && Array.isArray(exampleLabels[0])
          ? (exampleLabels[0] as string[])
          : null;
        const paramHint = labels && labels.length
          ? ` | parameters: [${labels.map((l: string, i: number) => `{{${i + 1}}}=${l}`).join(", ")}]`
          : "";
        return `${t.name} (${t.category}, ${t.language})${paramHint}`;
      }).join("\n");
    },
  },

  send_template: {
    description:
      "Send an approved WhatsApp message template to the current customer (confirmation, reminder, notification). Use list_templates first to find the template name.",
    parameters: z.object({
      template_name: z.string().describe("Exact name of an approved template"),
      parameters: z
        .array(z.string())
        .optional()
        .describe("Positional values for the template body placeholders, in order"),
    }),
    execute: async (ctx, args) => {
      const { template_name, parameters } = args as { template_name: string; parameters?: string[] };
      if (!ctx.conversationId || !ctx.contactId) return "There is no active WhatsApp conversation to send to.";
      const target = await resolveConversationSendTarget(ctx);
      if (!target) return "There is no active WhatsApp conversation to send to.";
      const { data, error } = await supabaseAdmin()
        .from("whatsapp_templates")
        .select("id, name, language")
        .eq("tenant_id", ctx.tenantId)
        .eq("wa_account_id", target.waAccountId)
        .eq("name", template_name)
        .eq("status", "approved")
        .maybeSingle();
      if (error || !data) {
        return `Template "${template_name}" is not approved or not available. Check list_templates.`;
      }
      const template = data as { id: string; name: string; language: string };
      const message = await enqueueOutboundMessage({
        tenantId: ctx.tenantId,
        channel: "whatsapp",
        channelAccountId: target.waAccountId,
        conversationId: ctx.conversationId,
        contactId: ctx.contactId,
        senderId: target.senderId,
        content: { type: "template", meta: { template_id: template.id, parameters } },
        templateId: template.id,
      });
      return `Sent template "${template.name}" to the customer (message ${message.id} queued).`;
    },
  },

  list_flows: {
    description:
      "List the published WhatsApp Flows (interactive forms) this business can send for booking, feedback, or surveys. Call before trigger_flow.",
    parameters: z.object({}),
    execute: async (ctx) => {
      const { data, error } = await supabaseAdmin()
        .from("flows")
        .select("name")
        .eq("tenant_id", ctx.tenantId)
        .eq("status", "published")
        .order("name", { ascending: true });
      if (error) return "Flows are temporarily unavailable. Escalate to a human.";
      const flows = (data as { name: string }[] ?? []);
      if (!flows.length) return "No published flows are available for this business.";
      return flows.map((f) => f.name).join("\n");
    },
  },

  trigger_flow: {
    description:
      "Trigger a published WhatsApp Flow (interactive form) to the current customer — e.g. for booking or feedback collection. Use list_flows first to see available flows.",
    parameters: z.object({
      flow_name: z.string().optional().describe("Exact name of a published flow; defaults to the first published flow"),
      cta_text: z.string().optional().describe("Button label on the flow's launch message"),
      data: z.string().optional().describe("Optional pre-filled values as a JSON string, e.g. '{\"key\": \"value\"}'"),
    }),
    execute: async (ctx, args) => {
      const { flow_name, cta_text, data } = args as {
        flow_name?: string;
        cta_text?: string;
        data?: string;
      };
      const parsedData = data ? JSON.parse(data) : undefined;
      if (!ctx.conversationId || !ctx.contactId) return "There is no active WhatsApp conversation to send to.";
      const target = await resolveConversationSendTarget(ctx);
      if (!target) return "There is no active WhatsApp conversation to send to.";
      let query = supabaseAdmin()
        .from("flows")
        .select("id, name, meta_flow_id")
        .eq("tenant_id", ctx.tenantId)
        .eq("wa_account_id", target.waAccountId)
        .eq("status", "published");
      if (flow_name) query = query.eq("name", flow_name);
      const { data: flow, error } = await query.limit(1).maybeSingle();
      if (error || !flow) {
        return flow_name
          ? `Flow "${flow_name}" is not published or not available. Check list_flows.`
          : "No published flow is available. Check list_flows.";
      }
      const f = flow as { id: string; name: string; meta_flow_id: string };
      const message = await enqueueOutboundMessage({
        tenantId: ctx.tenantId,
        channel: "whatsapp",
        channelAccountId: target.waAccountId,
        conversationId: ctx.conversationId,
        contactId: ctx.contactId,
        senderId: target.senderId,
        content: {
          type: "flow",
          meta: { flowId: f.meta_flow_id, ctaText: cta_text ?? "Start", data: parsedData ?? {} },
        },
      });
      return `Triggered flow "${f.name}" for the customer (message ${message.id} queued).`;
    },
  },

  create_template: {
    description:
      "Create a new WhatsApp message template and submit it to Meta for approval. Use when the customer or business needs a new template that doesn't exist yet. The template will be pending until Meta reviews it.",
    parameters: z.object({
      name: z.string().describe("Template name (lowercase, underscores only, e.g. order_confirmation)"),
      language: z.string().default("en_US").describe("Language code, e.g. en_US, es_MX"),
      category: z.enum(["MARKETING", "UTILITY", "AUTHENTICATION"]).describe("Template category"),
      body: z.string().describe("Template body text. Use {{1}}, {{2}} etc. for dynamic variables"),
      sub_category: z.string().optional().describe("Optional sub-category"),
    }),
    execute: async (ctx, args) => {
      const { name, language, category, body, sub_category } = args as {
        name: string;
        language: string;
        category: "MARKETING" | "UTILITY" | "AUTHENTICATION";
        body: string;
        sub_category?: string;
      };

      // Resolve WA account from conversation, or fall back to first for tenant
      let waAccountId: string | null = null;
      if (ctx.conversationId) {
        const { data: conv } = await supabaseAdmin()
          .from("conversations")
          .select("wa_account_id")
          .eq("id", ctx.conversationId)
          .maybeSingle();
        waAccountId = (conv as { wa_account_id: string | null } | null)?.wa_account_id ?? null;
      }
      if (!waAccountId) {
        const { data: acc } = await supabaseAdmin()
          .from("wa_accounts")
          .select("id")
          .eq("tenant_id", ctx.tenantId)
          .limit(1)
          .maybeSingle();
        waAccountId = acc?.id ?? null;
      }
      if (!waAccountId) return "No WhatsApp account configured. Cannot create template.";

      try {
        const template = await createTemplate({
          tenantId: ctx.tenantId,
          waAccountId,
          name: name.toLowerCase().replace(/\s+/g, "_"),
          language,
          category,
          components: [{ type: "BODY", text: body }],
          subCategory: sub_category,
        });
        return `Template "${template.name}" created and submitted to Meta for approval (status: pending).`;
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        return `Failed to create template: ${detail}`;
      }
    },
  },

  get_current_datetime: {
    description:
      "Returns the current date and time in the business timezone. Call this before resolving any relative date reference if you are unsure.",
    parameters: z.object({}),
    execute: async (ctx) => {
      const business = await defaultBusiness(ctx.tenantId);
      const timezone = business?.timezone ?? "UTC";
      const now = new Date();
      const formatted = new Intl.DateTimeFormat("en-US", {
        dateStyle: "full",
        timeStyle: "short",
        timeZone: timezone,
      }).format(now);
      return `Current date/time: ${formatted} (${timezone}) — ISO: ${now.toISOString()}`;
    },
  },
};

/** Every registered tool name — used to seed `agent_tools` on agent creation. */
export const DEFAULT_AGENT_TOOLS: readonly string[] = Object.keys(tools);

/** Resolve the wa_account + customer phone needed to send outbound. */
async function resolveConversationSendTarget(ctx: AgentToolCtx): Promise<{ waAccountId: string; senderId: string } | null> {
  if (!ctx.conversationId || !ctx.contactId) return null;

  const { data, error } = await supabaseAdmin()
    .from("conversations")
    .select("wa_account_id, contacts(phone_number)")
    .eq("id", ctx.conversationId)
    .maybeSingle();
  if (error) return null;

  const row = data as { wa_account_id: string | null; contacts: { phone_number: string | null } | { phone_number: string | null }[] | null } | null;
  const contact = row?.contacts;
  const senderId = Array.isArray(contact) ? contact[0]?.phone_number : contact?.phone_number;
  if (!row?.wa_account_id || !senderId) return null;

  return { waAccountId: row.wa_account_id, senderId };
}

async function defaultBusiness(tenantId: string) {
  const { data } = await supabaseAdmin()
    .from("businesses")
    .select("id, name, timezone")
    .eq("tenant_id", tenantId)
    .limit(1)
    .maybeSingle();
  return data;
}

async function defaultService(businessId: string) {
  const { data } = await supabaseAdmin()
    .from("services")
    .select("id, name, default_duration_minutes, active_schema_id")
    .eq("business_id", businessId)
    .eq("enabled", true)
    .limit(1)
    .maybeSingle();
  return data;
}

async function serviceByName(businessId: string, name: string) {
  const { data } = await supabaseAdmin()
    .from("services")
    .select("id, name, default_duration_minutes, active_schema_id")
    .eq("business_id", businessId)
    .eq("enabled", true)
    .ilike("name", `%${name}%`)
    .limit(1)
    .maybeSingle();
  return data;
}

async function resourceByName(businessId: string, name: string) {
  const { data } = await supabaseAdmin()
    .from("resources")
    .select("id, name, type")
    .eq("business_id", businessId)
    .eq("enabled", true)
    .ilike("name", `%${name}%`)
    .limit(1)
    .maybeSingle();
  return data;
}

function groupBy<T>(arr: T[], key: (t: T) => string): Record<string, T[]> {
  return arr.reduce<Record<string, T[]>>((acc, item) => {
    const k = key(item);
    (acc[k] ??= []).push(item);
    return acc;
  }, {});
}

/** Build the AI SDK ToolSet for an agent, honoring its enabled tools. */
export function buildAgentTools(enabledTools: string[], ctx: AgentToolCtx): ToolSet {  const result: ToolSet = {};
  for (const [name, def] of Object.entries(tools)) {
    if (!enabledTools.includes(name)) continue;
    result[name] = {
      description: def.description,
      inputSchema: def.parameters as FlexibleSchema<unknown>,
      execute: async (args: unknown) => def.execute(ctx, args),
    } as ToolSet[string];
  }
  return result;
}
