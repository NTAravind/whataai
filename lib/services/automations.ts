import { supabaseAdmin, unwrap } from "@/lib/clients/supabase";
import { HttpError } from "@/lib/http";
import { automationStepsSchema, triggerConfigSchema } from "@/lib/automations/types";
import type { AutomationStep, TriggerConfig } from "@/lib/automations/types";

export interface AutomationRow {
  id: string;
  tenant_id: string;
  agent_id: string | null;
  name: string;
  is_active: boolean;
  trigger_type: "after_agent_reply" | "on_tool_call" | "ai_capture" | "manual";
  trigger_config: TriggerConfig;
  steps: AutomationStep[];
  created_at: string;
  updated_at: string;
}

export interface CreateAutomationInput {
  name: string;
  agentId?: string | null;
  isActive?: boolean;
  triggerType: AutomationRow["trigger_type"];
  triggerConfig?: unknown;
  steps?: unknown;
}

export async function listAutomations(tenantId: string): Promise<AutomationRow[]> {
  const data = unwrap(
    await supabaseAdmin()
      .from("automations")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false }),
  );
  return (data as AutomationRow[]).map(normalizeRow);
}

export async function getAutomation(tenantId: string, id: string): Promise<AutomationRow> {
  const data = unwrap(
    await supabaseAdmin()
      .from("automations")
      .select("*")
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .maybeSingle(),
  );
  return normalizeRow(data as AutomationRow);
}

function normalizeRow(row: AutomationRow): AutomationRow {
  return {
    ...row,
    steps: row.steps ?? [],
    trigger_config: row.trigger_config ?? {},
  };
}

export async function createAutomation(tenantId: string, input: CreateAutomationInput): Promise<AutomationRow> {
  const triggerConfig = triggerConfigSchema.safeParse(input.triggerConfig ?? {});
  const steps = automationStepsSchema.safeParse(input.steps ?? []);
  if (!triggerConfig.success) {
    throw new HttpError(400, "trigger_config is invalid");
  }
  if (!steps.success) {
    throw new HttpError(400, "steps are invalid: at least one step is required");
  }
  if (!input.name) throw new HttpError(400, "name is required");

  const data = unwrap(
    await supabaseAdmin()
      .from("automations")
      .insert({
        tenant_id: tenantId,
        agent_id: input.agentId ?? null,
        name: input.name,
        is_active: input.isActive ?? true,
        trigger_type: input.triggerType,
        trigger_config: triggerConfig.data,
        steps: steps.data,
      })
      .select()
      .single(),
  );
  return normalizeRow(data as AutomationRow);
}

export interface UpdateAutomationInput {
  name?: string;
  agentId?: string | null;
  isActive?: boolean;
  triggerType?: AutomationRow["trigger_type"];
  triggerConfig?: unknown;
  steps?: unknown;
}

export async function updateAutomation(
  tenantId: string,
  id: string,
  input: UpdateAutomationInput,
): Promise<AutomationRow> {
  await getAutomation(tenantId, id); // 404 if not found
  const patch: Record<string, unknown> = {};

  if (input.name !== undefined) patch.name = input.name;
  if (input.agentId !== undefined) patch.agent_id = input.agentId;
  if (input.isActive !== undefined) patch.is_active = input.isActive;
  if (input.triggerType !== undefined) patch.trigger_type = input.triggerType;

  if (input.triggerConfig !== undefined) {
    const parsed = triggerConfigSchema.safeParse(input.triggerConfig);
    if (!parsed.success) throw new HttpError(400, "trigger_config is invalid");
    patch.trigger_config = parsed.data;
  }
  if (input.steps !== undefined) {
    const parsed = automationStepsSchema.safeParse(input.steps);
    if (!parsed.success) throw new HttpError(400, "steps are invalid");
    patch.steps = parsed.data;
  }

  patch.updated_at = new Date().toISOString();

  const data = unwrap(
    await supabaseAdmin().from("automations").update(patch).eq("id", id).eq("tenant_id", tenantId).select().single(),
  );
  return normalizeRow(data as AutomationRow);
}

export async function deleteAutomation(tenantId: string, id: string): Promise<void> {
  const { error } = await supabaseAdmin().from("automations").delete().eq("id", id).eq("tenant_id", tenantId);
  if (error) throw new HttpError(500, error.message);
}

/**
 * Load active automations that should fire for a given agent/trigger pair.
 * `agentId` null means "all agents", so there's no row whose agent_id is null.
 */
export async function listActiveAutomationsForTrigger(
  tenantId: string,
  triggerType: AutomationRow["trigger_type"],
  agentId?: string | null,
): Promise<AutomationRow[]> {
  const query = supabaseAdmin()
    .from("automations")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .eq("trigger_type", triggerType);
  if (agentId) {
    query.or(`agent_id.eq.${agentId},agent_id.is.null`);
  } else {
    query.is("agent_id", null);
  }
  const data = unwrap(await query.order("created_at", { ascending: true }));
  return (data as AutomationRow[]).map(normalizeRow);
}

/** Duplicate an automation under a fresh id (name suffixed), no run history. */
export async function duplicateAutomation(tenantId: string, id: string): Promise<AutomationRow> {
  const source = await getAutomation(tenantId, id);
  return createAutomation(tenantId, {
    name: `${source.name} (copy)`,
    agentId: source.agent_id,
    isActive: source.is_active,
    triggerType: source.trigger_type,
    triggerConfig: source.trigger_config,
    steps: source.steps,
  });
}