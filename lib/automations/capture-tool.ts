import { z } from "zod";
import { supabaseAdmin } from "@/lib/clients/supabase";
import { inngest } from "@/lib/clients/ingest";
import { automationTriggered } from "@/lib/inngest/events";
import { updateContactMetadata } from "@/lib/services/contacts";
import type { ToolDef } from "@/lib/agents/registry";
import type { AutomationRow } from "@/lib/services/automations";
import type { CaptureField } from "@/lib/automations/types";

/**
 * Dynamic capture tools for `ai_capture` automations (lib/automations/
 * capture-tool.ts).
 *
 * For every active `ai_capture` automation scoped to the agent running the
 * conversation, expose a tool named `capture_<automation.id>` whose Zod schema
 * comes from `trigger_config.fields`. The description tells the model to ask
 * conversationally for any missing field BEFORE calling it.
 *
 * The tool itself does NOT call the CRM — it fires `automation/triggered`
 * with the caller's arguments as the run's top-level variables (so the
 * api_call step can interpolate `{{customer_name}}` directly), and persists
 * any `saveToContact` field onto the contact record.
 */

interface CaptureAutomationRow extends AutomationRow {
  trigger_config: { fields: CaptureField[] };
}

async function loadCaptureAutomations(tenantId: string, agentId?: string | null): Promise<CaptureAutomationRow[]> {
  const query = supabaseAdmin()
    .from("automations")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .eq("trigger_type", "ai_capture");
  if (agentId) {
    query.or(`agent_id.eq.${agentId},agent_id.is.null`);
  } else {
    query.is("agent_id", null);
  }
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as CaptureAutomationRow[];
}

function buildFieldSchema(fields: CaptureField[]): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const field of fields) {
    const base = field.type === "number" ? z.number() : z.string();
    shape[field.name] = field.required ? base.describe(field.description) : base.optional().describe(field.description);
  }
  return z.object(shape);
}

function buildToolDescription(automation: CaptureAutomationRow): string {
  const fields = automation.trigger_config.fields;
  const list = fields
    .map((f) => `- ${f.name} (${f.type}): ${f.description}${f.required ? " [REQUIRED]" : " [optional]"}`)
    .join("\n");
  return `Capture structured details from the customer for the "${automation.name}" workflow.\n
Ask the customer conversationally for any of the following details you do not already have, then call this tool with ONLY the values you gathered (plus anything you already know). Do not call it until the required values are known.\n
Required fields:\n${list}`;
}

export interface CaptureTool extends ToolDef {
  name: string;
}

export async function buildCaptureTools(
  tenantId: string,
  agentId?: string | null,
): Promise<CaptureTool[]> {
  const automations = await loadCaptureAutomations(tenantId, agentId);
  const tools: CaptureTool[] = [];

  for (const automation of automations) {
    const fields = automation.trigger_config.fields;
    const parameters = buildFieldSchema(fields);

    tools.push({
      name: `capture_${automation.id}`,
      description: buildToolDescription(automation),
      parameters,
      execute: async (_ctx, args) => {
        const variables = (args ?? {}) as Record<string, unknown>;

        const saveTargets = fields.filter((f) => f.saveToContact);
        if (saveTargets.length > 0 && _ctx.contactId) {
          const metadataPatch: Record<string, unknown> = {};
          for (const f of saveTargets) {
            if (variables[f.name] !== undefined) metadataPatch[f.name] = variables[f.name];
          }
          if (Object.keys(metadataPatch).length > 0) {
            await updateContactMetadata(_ctx.tenantId, _ctx.contactId, metadataPatch);
          }
        }

        await inngest.send({
          name: automationTriggered.name,
          data: {
            automationId: automation.id,
            tenantId: _ctx.tenantId,
            conversationId: _ctx.conversationId,
            contactId: _ctx.contactId,
            variables,
          },
        });

        return JSON.stringify({
          ok: true,
          message: `Captured ${Object.keys(variables).length} field(s); the "${automation.name}" workflow will now run.`,
        });
      },
    });
  }

  return tools;
}