import type { FlexibleSchema, ToolSet } from "ai";
import { z } from "zod";
import { searchKnowledgeBase } from "@/lib/services/kb";
import { checkAvailability } from "@/lib/services/availability";
import { createBooking } from "@/lib/services/bookings";
import { supabaseAdmin } from "@/lib/clients/supabase";
import { setConversationStatus } from "@/lib/services/conversations";
import { enqueueOutboundMessage } from "@/lib/services/messages";

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

type ToolDef = {
  description: string;
  parameters: z.ZodTypeAny;
  execute: (ctx: AgentToolCtx, args: unknown) => Promise<string>;
};

const tools: Record<string, ToolDef> = {
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
      "Check open booking slots. Call before suggesting a specific time to a customer. Requires a business to be configured.",
    parameters: z.object({
      date: z.string().describe("Date to check, YYYY-MM-DD"),
      duration_minutes: z.number().optional().describe("Optional requested duration"),
    }),
    execute: async (ctx, args) => {
      const { date, duration_minutes } = args as { date: string; duration_minutes?: number };
      const business = await defaultBusiness(ctx.tenantId);
      if (!business) return "No business is configured for this workspace. Escalate to a human.";
      const service = await defaultService(business.id);
      if (!service) return "No bookable service configured. Escalate to a human.";
      const slots = await checkAvailability({
        tenantId: ctx.tenantId,
        businessId: business.id,
        serviceId: service.id,
        from: date,
        to: date,
        durationMinutes: duration_minutes,
      });
      if (!slots.length) return `No slots available on ${date}. Offer the next available day.`;
      const byResource = groupBy(slots, (s) => s.resourceName ?? "Any");
      return Object.entries(byResource)
        .map(([name, slotList]) => `${name}: ${slotList.map((s) => s.start.slice(11, 16)).join(", ")}`)
        .join("\n");
    },
  },

  create_booking: {
    description:
      "Create a confirmed booking for the customer at a specific date and time. Only call this AFTER the customer has agreed to the slot.",
    parameters: z.object({
      date: z.string().describe("Date of the booking, YYYY-MM-DD"),
      time: z.string().describe("Start time of the booking, 24h HH:MM"),
      service_name: z.string().optional().describe("Optional service name"),
    }),
    execute: async (ctx, args) => {
      const { date, time, service_name } = args as { date: string; time: string; service_name?: string };
      const business = await defaultBusiness(ctx.tenantId);
      if (!business) return "No business configured. Cannot book. Escalate to a human.";
      const service = service_name ? await serviceByName(business.id, service_name) : await defaultService(business.id);
      if (!service) return "Service not found. Cannot book. Escalate to a human.";

      const start = new Date(`${date}T${time}:00Z`);
      if (Number.isNaN(start.getTime())) return "Invalid date/time provided.";

      const booking = await createBooking({
        tenantId: ctx.tenantId,
        businessId: business.id,
        serviceId: service.id,
        serviceSchemaId: service.active_schema_id,
        customerId: ctx.contactId,
        conversationId: ctx.conversationId,
        startTime: start.toISOString(),
        endTime: new Date(start.getTime() + (service.default_duration_minutes ?? 30) * 60_000).toISOString(),
        timezone: business.timezone ?? "UTC",
        bookingData: { customer_name: ctx.customerName ?? null },
      });
      return `Booking confirmed (id ${booking.id}) for ${date} at ${time}.`;
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
        .select("name, language, category")
        .eq("tenant_id", ctx.tenantId)
        .eq("status", "approved")
        .order("name", { ascending: true });
      if (error) return `Template lookup failed: ${error.message}`;
      const templates = (data as { name: string; language: string; category: string }[] ?? []).filter(
        (t) => !category || t.category === category,
      );
      if (!templates.length) return "No approved templates are available for this business.";
      return templates.map((t) => `${t.name} (${t.category}, ${t.language})`).join("\n");
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
      if (error) return `Flow lookup failed: ${error.message}`;
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
      data: z.record(z.string(), z.unknown()).optional().describe("Optional pre-filled values"),
    }),
    execute: async (ctx, args) => {
      const { flow_name, cta_text, data } = args as {
        flow_name?: string;
        cta_text?: string;
        data?: Record<string, unknown>;
      };
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
          meta: { flowId: f.meta_flow_id, ctaText: cta_text ?? "Start", data: data ?? {} },
        },
      });
      return `Triggered flow "${f.name}" for the customer (message ${message.id} queued).`;
    },
  },
};

/** Every registered tool name — used to seed `agent_tools` on agent creation. */
export const DEFAULT_AGENT_TOOLS: readonly string[] = Object.keys(tools);

/** Resolve the wa_account + customer phone needed to send outbound. */
async function resolveConversationSendTarget(ctx: AgentToolCtx): Promise<{ waAccountId: string; senderId: string } | null> {
  if (!ctx.conversationId || !ctx.contactId) return null;

  const { data: conv } = await supabaseAdmin()
    .from("conversations")
    .select("wa_account_id")
    .eq("id", ctx.conversationId)
    .maybeSingle();
  const waAccountId = (conv as { wa_account_id: string | null } | null)?.wa_account_id;
  if (!waAccountId) return null;

  const { data: contact } = await supabaseAdmin()
    .from("contacts")
    .select("phone_number")
    .eq("id", ctx.contactId)
    .maybeSingle();
  const senderId = (contact as { phone_number: string | null } | null)?.phone_number;
  if (!senderId) return null;

  return { waAccountId, senderId };
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
