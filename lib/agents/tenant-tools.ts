import { z } from "zod";
import { FlexibleSchema, ToolSet } from "ai";
import { supabaseAdmin, unwrap } from "@/lib/clients/supabase";
import { AgentToolCtx, ToolDef, tools as sharedTools } from "./registry";
import { deleteTemplate } from "@/lib/services/templates";
import { createAppointmentService, createResource, deleteAppointmentService, deleteResource, getResource, listAppointmentServices, updateAppointmentService, updateResource } from "@/lib/services/appointments";
import { inngest } from "@/lib/clients/ingest";

// Define the tenant-specific tools
const tenantTools: Record<string, ToolDef> = {
  list_contacts: {
    description: "List all contacts for the tenant.",
    parameters: z.object({}),
    execute: async (ctx) => {
      const { data } = await supabaseAdmin()
        .from("contacts")
        .select("id, full_name, phone_number, email")
        .eq("tenant_id", ctx.tenantId);
      return JSON.stringify(data ?? []);
    },
  },
  
  get_contact: {
    description: "Fetch a single contact's details by name or phone.",
    parameters: z.object({
      query: z.string().describe("Name or phone number to search for"),
    }),
    execute: async (ctx, args) => {
      const { query } = args as { query: string };
      const { data } = await supabaseAdmin()
        .from("contacts")
        .select()
        .eq("tenant_id", ctx.tenantId)
        .or(`full_name.ilike.%${query}%,phone_number.ilike.%${query}%`)
        .limit(1)
        .maybeSingle();
      return JSON.stringify(data ?? { error: "Contact not found" });
    },
  },

  list_businesses: {
    description: "List all businesses under this tenant.",
    parameters: z.object({}),
    execute: async (ctx) => {
      const { data } = await supabaseAdmin()
        .from("businesses")
        .select("id, name, timezone")
        .eq("tenant_id", ctx.tenantId);
      return JSON.stringify(data ?? []);
    },
  },

  get_business: {
    description: "Get details of a specific business.",
    parameters: z.object({
      businessId: z.string().describe("ID of the business"),
    }),
    execute: async (ctx, args) => {
      const { businessId } = args as { businessId: string };
      const { data } = await supabaseAdmin()
        .from("businesses")
        .select()
        .eq("tenant_id", ctx.tenantId)
        .eq("id", businessId)
        .maybeSingle();
      return JSON.stringify(data ?? { error: "Business not found" });
    },
  },

  list_services: {
    description: "List services for a given business.",
    parameters: z.object({
      businessId: z.string().describe("ID of the business"),
    }),
    execute: async (ctx, args) => {
      const { businessId } = args as { businessId: string };
      const { data } = await supabaseAdmin()
        .from("services")
        .select("id, name, description, default_duration_minutes")
        .eq("business_id", businessId);
      return JSON.stringify(data ?? []);
    },
  },

  list_bookings: {
    description: "List bookings (filter by date, status).",
    parameters: z.object({
      status: z.string().optional().describe("Booking status to filter by"),
    }),
    execute: async (ctx, args) => {
      const { status } = args as { status?: string };
      let query = supabaseAdmin()
        .from("bookings")
        .select("id, status, start_time, end_time, contact:contacts(full_name)")
        .eq("tenant_id", ctx.tenantId);
      
      if (status) query = query.eq("status", status);
      const { data } = await query.order("start_time", { ascending: true });
      return JSON.stringify(data ?? []);
    },
  },

  create_service: {
    description:
      "Create a new appointment service (the thing being booked: consultation, haircut, room-night, class) under a business.",
    parameters: z.object({
      businessId: z.string().describe("ID of the business the service belongs to"),
      name: z.string().describe("Service name"),
      description: z.string().optional().describe("Optional description"),
      bookingMode: z.string().optional().describe("Booking mode: duration, fixed_slot, multi_day, or open"),
      defaultDurationMinutes: z.number().optional().describe("Default duration in minutes"),
      requiresResourceType: z.string().optional().describe("Required resource type, e.g. staff, room"),
    }),
    execute: async (ctx, args) => {
      const { businessId, name, description, bookingMode, defaultDurationMinutes, requiresResourceType } = args as {
        businessId: string;
        name: string;
        description?: string;
        bookingMode?: string;
        defaultDurationMinutes?: number;
        requiresResourceType?: string;
      };
      if (!name.trim()) return "Error: name is required.";
      try {
        const service = await createAppointmentService({
          tenantId: ctx.tenantId,
          businessId,
          name: name.trim(),
          description,
          bookingMode,
          defaultDurationMinutes,
          requiresResourceType,
        });
        return `Service created: ${service.name} (${service.booking_mode}, id ${service.id}).`;
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        return `Failed to create service: ${detail}`;
      }
    },
  },

  update_service: {
    description: "Update an appointment service's name, description, booking mode, duration, resource requirement, or enabled status.",
    parameters: z.object({
      serviceId: z.string().describe("ID of the service to update"),
      name: z.string().optional().describe("New name"),
      description: z.string().optional().nullable().describe("New description (null clears it)"),
      bookingMode: z.string().optional().describe("New booking mode"),
      defaultDurationMinutes: z.number().optional().nullable().describe("New default duration in minutes"),
      requiresResourceType: z.string().optional().describe("New required resource type"),
      enabled: z.boolean().optional().describe("Whether the service is bookable"),
    }),
    execute: async (ctx, args) => {
      const { serviceId, ...updates } = args as {
        serviceId: string;
        name?: string;
        description?: string | null;
        bookingMode?: string;
        defaultDurationMinutes?: number | null;
        requiresResourceType?: string;
        enabled?: boolean;
      };
      try {
        const service = await updateAppointmentService(ctx.tenantId, serviceId, updates);
        return `Service updated: ${JSON.stringify(service)}`;
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        return `Failed to update service: ${detail}`;
      }
    },
  },

  delete_service: {
    description:
      "Delete an appointment service. This also removes its versioned schemas and any bookings. Requires explicit operator confirmation: call with confirm=false first — this returns a confirmation card the operator can approve in the chat UI. Set confirm=true only after the operator confirms.",
    parameters: z.object({
      serviceId: z.string().describe("ID of the service to delete"),
      confirm: z.boolean().describe("Must be true to actually delete; false returns a confirmation card"),
    }),
    execute: async (ctx, args) => {
      const { serviceId, confirm } = args as { serviceId: string; confirm: boolean };
      let name: string | null = null;
      try {
        const services = await listAppointmentServices(ctx.tenantId);
        name = services.find((s) => s.id === serviceId)?.name ?? null;
      } catch {
        // leave name null; the delete below surfaces the real error
      }
      if (!confirm) {
        return confirmRequest(
          "delete_service",
          "Delete service",
          `This will permanently delete service "${name ?? serviceId}" along with its versioned schemas and any bookings.`,
          `CONFIRMED: proceed with deleting service "${name ?? serviceId}" (id ${serviceId}) — set confirm=true and execute.`,
        );
      }
      try {
        await deleteAppointmentService(ctx.tenantId, serviceId);
        return `Service "${name ?? serviceId}" deleted.`;
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        return `Failed to delete service: ${detail}`;
      }
    },
  },

  create_resource: {
    description:
      "Create a new bookable resource (staff member, room, table, vehicle, equipment, or class) under a business.",
    parameters: z.object({
      businessId: z.string().describe("ID of the business this resource belongs to"),
      name: z.string().describe("Name of the resource"),
      type: z.string().optional().describe("Resource type, e.g. staff, room, table, vehicle, equipment, class (default staff)"),
      capacity: z.number().optional().describe("Optional capacity"),
    }),
    execute: async (ctx, args) => {
      const { businessId, name, type, capacity } = args as {
        businessId: string;
        name: string;
        type?: string;
        capacity?: number | null;
      };
      if (!name.trim()) return "Error: name is required.";
      try {
        const resource = await createResource({
          tenantId: ctx.tenantId,
          businessId,
          name: name.trim(),
          type: type?.trim() || "staff",
          capacity,
        });
        return `Resource created: ${resource.name} (${resource.type}, id ${resource.id}).`;
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        return `Failed to create resource: ${detail}`;
      }
    },
  },

  get_resource: {
    description: "Get detailed info for a single bookable resource by its ID.",
    parameters: z.object({
      resourceId: z.string().describe("ID of the resource"),
    }),
    execute: async (ctx, args) => {
      const { resourceId } = args as { resourceId: string };
      try {
        const resource = await getResource(ctx.tenantId, resourceId);
        return JSON.stringify(resource);
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        return `Error: ${detail}`;
      }
    },
  },

  update_resource: {
    description: "Update a resource's name, type, capacity, or enabled status.",
    parameters: z.object({
      resourceId: z.string().describe("ID of the resource to update"),
      name: z.string().optional().describe("New name"),
      type: z.string().optional().describe("New type, e.g. staff, room, vehicle"),
      capacity: z.number().optional().describe("New capacity"),
      enabled: z.boolean().optional().describe("Whether the resource is bookable"),
    }),
    execute: async (ctx, args) => {
      const { resourceId, ...updates } = args as {
        resourceId: string;
        name?: string;
        type?: string;
        capacity?: number;
        enabled?: boolean;
      };
      try {
        const resource = await updateResource(ctx.tenantId, resourceId, updates);
        return `Resource updated: ${JSON.stringify(resource)}`;
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        return `Failed to update resource: ${detail}`;
      }
    },
  },

  delete_resource: {
    description:
      "Delete a resource. This also removes its availability rules, availability exceptions, and bookings. Requires explicit operator confirmation: call with confirm=false first — this returns a confirmation card the operator can approve in the chat UI. Set confirm=true only after the operator confirms.",
    parameters: z.object({
      resourceId: z.string().describe("ID of the resource to delete"),
      confirm: z.boolean().describe("Must be true to actually delete; false returns a confirmation card"),
    }),
    execute: async (ctx, args) => {
      const { resourceId, confirm } = args as { resourceId: string; confirm: boolean };
      let name: string | null = null;
      try {
        name = (await getResource(ctx.tenantId, resourceId)).name;
      } catch {
        // leave name null; the delete below surfaces the real error
      }
      if (!confirm) {
        return confirmRequest(
          "delete_resource",
          "Delete resource",
          `This will permanently delete resource "${name ?? resourceId}" along with its availability rules, exceptions, and bookings.`,
          `CONFIRMED: proceed with deleting resource "${name ?? resourceId}" (id ${resourceId}) — set confirm=true and execute.`,
        );
      }
      try {
        await deleteResource(ctx.tenantId, resourceId);
        return `Resource "${name ?? resourceId}" deleted.`;
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        return `Failed to delete resource: ${detail}`;
      }
    },
  },

  list_conversations: {
    description: "List recent customer conversations.",
    parameters: z.object({}),
    execute: async (ctx) => {
      const { data } = await supabaseAdmin()
        .from("conversations")
        .select("id, status, last_message_at, contact:contacts(full_name, phone_number)")
        .eq("tenant_id", ctx.tenantId)
        .order("last_message_at", { ascending: false })
        .limit(20);
      return JSON.stringify(data ?? []);
    },
  },

  get_conversation: {
    description: "Get message history for a conversation.",
    parameters: z.object({
      conversationId: z.string().describe("ID of the conversation"),
    }),
    execute: async (ctx, args) => {
      const { conversationId } = args as { conversationId: string };
      const { data } = await supabaseAdmin()
        .from("messages")
        .select("role, content, created_at")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true })
        .limit(50);
      return JSON.stringify(data ?? []);
    },
  },

  bulk_send_template: {
    description:
      "Send an approved template to multiple contacts. Requires explicit operator confirmation: call list_contacts/get_contact first to resolve the recipients, then call with confirm=false — this returns a confirmation card showing the exact recipient count for the operator to approve. Set confirm=true only after the operator confirms.",
    parameters: z.object({
      templateName: z.string(),
      contactIds: z.array(z.string()).describe("List of contact IDs to send to"),
      variables: z.record(z.string(), z.string()).optional().describe("Variables mapped to template like {'1': 'John'}"),
      confirm: z.boolean().default(false).describe("Must be true to actually send; false returns a confirmation card with the recipient count"),
    }),
    execute: async (ctx, args) => {
      const { templateName, contactIds, variables, confirm } = args as { templateName: string, contactIds: string[], variables?: Record<string,string>, confirm?: boolean };

      if (contactIds.length === 0) return "No contacts selected.";

      if (!confirm) {
        return confirmRequest(
          "bulk_send_template",
          "Send WhatsApp template",
          `Send template "${templateName}" to ${contactIds.length} contact${contactIds.length === 1 ? "" : "s"}?`,
          `CONFIRMED: send template "${templateName}" to the ${contactIds.length} selected contacts — set confirm=true and execute.`,
        );
      }

      // Enqueue to Inngest for safe rate-limiting
      await inngest.send({
        name: "whatsapp/bulk.send",
        data: {
          tenantId: ctx.tenantId,
          templateName,
          contactIds,
          variables
        }
      });
      return `Enqueued bulk send for ${contactIds.length} contacts. Background job started.`;
    },
  },

  list_agents: {
    description: "List all AI agents configured for this tenant.",
    parameters: z.object({}),
    execute: async (ctx) => {
      const { data } = await supabaseAdmin()
        .from("agents")
        .select("id, name, type, enabled")
        .eq("tenant_id", ctx.tenantId);
      return JSON.stringify(data ?? []);
    },
  },

  update_agent: {
    description: "Update an agent's name, instructions, or enabled status.",
    parameters: z.object({
      agentId: z.string(),
      name: z.string().optional(),
      instructions: z.string().optional(),
      enabled: z.boolean().optional(),
    }),
    execute: async (ctx, args) => {
      const { agentId, ...updates } = args as any;
      const { data, error } = await supabaseAdmin()
        .from("agents")
        .update(updates)
        .eq("id", agentId)
        .eq("tenant_id", ctx.tenantId)
        .select()
        .single();
      if (error) return `Error: ${error.message}`;
      return `Agent updated successfully: ${JSON.stringify(data)}`;
    },
  },

  list_kb_documents: {
    description: "List knowledge base articles.",
    parameters: z.object({}),
    execute: async (ctx) => {
      const { data } = await supabaseAdmin()
        .from("knowledge_base_documents")
        .select("id, title, status")
        .eq("tenant_id", ctx.tenantId);
      return JSON.stringify(data ?? []);
    },
  },

  get_usage_summary: {
    description: "Get token usage and cost summary.",
    parameters: z.object({}),
    execute: async (ctx) => {
      const { data } = await supabaseAdmin()
        .from("usage_counters")
        .select("period_start, period_end, tokens_used, cost_usd")
        .eq("tenant_id", ctx.tenantId)
        .order("period_start", { ascending: false });
      return JSON.stringify(data ?? []);
    },
  },
  
  delete_template: {
    description:
      "Delete a WhatsApp template by its local ID or exact name. Removes the local record and best-effort removes it from Meta if it exists there. Requires explicit operator confirmation: call with confirm=false first — this returns a confirmation card the operator can approve in the chat UI. Set confirm=true only after the operator confirms.",
    parameters: z.object({
      templateName: z.string().describe("Exact name of the template to delete"),
      confirm: z.boolean().default(false).describe("Must be true to actually delete; false returns a confirmation card"),
    }),
    execute: async (ctx, args) => {
      const { templateName, confirm } = args as { templateName: string; confirm?: boolean };
      if (!confirm) {
        return confirmRequest(
          "delete_template",
          "Delete WhatsApp template",
          `This will delete template "${templateName}" from your account and best-effort remove it from Meta if it exists there.`,
          `CONFIRMED: proceed with deleting template "${templateName}" — set confirm=true and execute.`,
        );
      }
      const { data: rows } = await supabaseAdmin()
        .from("whatsapp_templates")
        .select("id")
        .eq("tenant_id", ctx.tenantId)
        .eq("name", templateName)
        .maybeSingle();
      if (!rows) {
        return `Template "${templateName}" was not found for this tenant.`;
      }
      try {
        await deleteTemplate((rows as { id: string }).id, ctx.tenantId);
        return `Template "${templateName}" deleted.`;
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        return `Failed to delete template "${templateName}": ${detail}`;
      }
    },
  },

  create_template: {
    description:
      "Draft a new WhatsApp template and return a preview for the operator to approve. Does NOT submit to Meta — the operator must approve it in the UI, which submits it for review. Include all components (HEADER/BODY/FOOTER/BUTTONS) so the preview can render faithfully.",
    parameters: z.object({
      name: z.string().describe("Template name, lowercase with underscores"),
      category: z.enum(["MARKETING", "UTILITY", "AUTHENTICATION"]),
      language: z.string().default("en_US"),
      components: z.array(z.any()).describe("WhatsApp template components array"),
      subCategory: z.string().optional().describe("Optional sub-category"),
    }),
    execute: async (ctx, args) => {
      let waAccountId: string | null = null;
      const { data: acc } = await supabaseAdmin()
        .from("wa_accounts")
        .select("id")
        .eq("tenant_id", ctx.tenantId)
        .limit(1)
        .maybeSingle();
      waAccountId = (acc as { id: string | null } | null)?.id ?? null;

      if (!waAccountId) {
        return "No WhatsApp account configured for this tenant. Cannot draft a template.";
      }

      const template = { ...(args as object), waAccountId };
      const preview = {
        __type: "PENDING_PREVIEW",
        template,
      };
      return JSON.stringify(preview);
    },
  }
};

// Also bring in specific shared tools from the registry
const sharedToolNames = [
  "list_templates",
  "send_template",
  "check_availability",
  "create_booking",
  "cancel_booking",
  "search_knowledge_base",
  "list_resources"
];

/**
 * Build the CONFIRM_REQUEST payload the chat UI renders as a confirmation card.
 * Tools that need explicit operator approval return this when confirm=false.
 */
function confirmRequest(kind: string, title: string, message: string, confirmText: string): string {
  return JSON.stringify({
    __type: "CONFIRM_REQUEST",
    confirmKind: kind,
    title,
    message,
    confirmText,
  });
}

export function buildTenantAgentTools(tenantId: string): ToolSet {
  const result: ToolSet = {};
  const ctx: AgentToolCtx = { tenantId };

  // 1. Add tenant specific tools
  for (const [name, def] of Object.entries(tenantTools)) {
    result[name] = {
      description: def.description,
      inputSchema: def.parameters as FlexibleSchema<unknown>,
      execute: async (args: unknown) => def.execute(ctx, args),
    } as ToolSet[string];
  }

  // 2. Add selected shared tools
  for (const name of sharedToolNames) {
    const def = sharedTools[name];
    if (def) {
      result[name] = {
        description: def.description,
        inputSchema: def.parameters as FlexibleSchema<unknown>,
        execute: async (args: unknown) => def.execute(ctx, args),
      } as ToolSet[string];
    }
  }

  return result;
}
