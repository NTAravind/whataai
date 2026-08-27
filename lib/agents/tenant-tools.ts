import { z } from "zod";
import { FlexibleSchema, ToolSet } from "ai";
import { supabaseAdmin, unwrap } from "@/lib/clients/supabase";
import { AgentToolCtx, ToolDef, tools as sharedTools } from "./registry";
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
    description: "Send an approved template to multiple contacts. ALWAYS confirm count first.",
    parameters: z.object({
      templateName: z.string(),
      contactIds: z.array(z.string()).describe("List of contact IDs to send to"),
      variables: z.record(z.string(), z.string()).optional().describe("Variables mapped to template like {'1': 'John'}"),
    }),
    execute: async (ctx, args) => {
      const { templateName, contactIds, variables } = args as { templateName: string, contactIds: string[], variables?: Record<string,string> };
      
      if (contactIds.length === 0) return "No contacts selected.";
      
      if (contactIds.length > 50) {
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
      } else {
        // Immediate enqueue to messages table
        // We'll just trigger the same event to Inngest for simplicity, or handle synchronously
        await inngest.send({
          name: "whatsapp/bulk.send",
          data: {
            tenantId: ctx.tenantId,
            templateName,
            contactIds,
            variables
          }
        });
        return `Enqueued bulk send for ${contactIds.length} contacts.`;
      }
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
  
  create_template: {
    description: "Draft a new WhatsApp template. Outputs PENDING_PREVIEW format for UI.",
    parameters: z.object({
      name: z.string().describe("Template name, lowercase with underscores"),
      category: z.enum(["MARKETING", "UTILITY", "AUTHENTICATION"]),
      language: z.string().default("en_US"),
      components: z.array(z.any()).describe("WhatsApp template components array"),
    }),
    execute: async (ctx, args) => {
      // Intercept and return the structured preview JSON
      const preview = {
        __type: "PENDING_PREVIEW",
        template: args
      };
      return JSON.stringify(preview);
    }
  }
};

// Also bring in specific shared tools from the registry
const sharedToolNames = [
  "list_templates",
  "send_template",
  "delete_template",
  "check_availability",
  "create_booking",
  "cancel_booking",
  "search_knowledge_base"
];

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
