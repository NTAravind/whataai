import { supabaseAdmin, unwrap } from "@/lib/clients/supabase";
import { DEFAULT_AGENT_TOOLS } from "@/lib/agents/registry";

export interface AgentRow {
  id: string;
  tenant_id: string;
  type: string;
  name: string;
  instructions: string;
  model_config: Record<string, unknown>;
  enabled: boolean;
}

export interface AgentWithTools extends AgentRow {
  tools: string[];
}

export interface CreateAgentInput {
  tenantId: string;
  type: string;
  name: string;
  instructions?: string;
  model_config?: Record<string, unknown>;
  /** Tool set override; defaults to the full registry (DEFAULT_AGENT_TOOLS). */
  tools?: string[];
}

export interface UpdateAgentInput {
  type?: string;
  name?: string;
  instructions?: string;
  model_config?: Record<string, unknown>;
  enabled?: boolean;
  /** Replaces the agent's tool set entirely. */
  tools?: string[];
}

/**
 * Agent CRUD. `createAgent` seeds the `agent_tools` rows automatically so a
 * new agent is usable immediately (docs/guide.md §5 — `agent_tools` toggles
 * which registry tools each agent is exposed to).
 */
export async function createAgent(input: CreateAgentInput): Promise<AgentWithTools> {
  const admin = supabaseAdmin();

  const { data, error } = await admin
    .from("agents")
    .insert({
      tenant_id: input.tenantId,
      type: input.type,
      name: input.name,
      instructions: input.instructions ?? "",
      model_config: (input.model_config ?? {}) as unknown as Record<string, unknown>,
    })
    .select()
    .single();
  if (error) throw error;
  const agent = data as AgentRow;

  const tools = input.tools && input.tools.length ? input.tools : [...DEFAULT_AGENT_TOOLS];
  if (tools.length) {
    const { error: toolsErr } = await admin.from("agent_tools").insert(
      tools.map((tool_name) => ({ agent_id: agent.id, tool_name, config: {}, enabled: true })),
    );
    if (toolsErr) throw toolsErr;
  }

  return { ...agent, tools };
}

export async function listAgents(tenantId: string) {
  return unwrap(
    await supabaseAdmin()
      .from("agents")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false }),
  );
}

export async function getAgent(tenantId: string, agentId: string): Promise<AgentWithTools> {
  const admin = supabaseAdmin();

  const { data, error } = await admin
    .from("agents")
    .select("*")
    .eq("id", agentId)
    .eq("tenant_id", tenantId)
    .single();
  if (error || !data) throw error ?? new Error("Agent not found");
  const agent = data as AgentRow;

  const tools = unwrap(
    await admin.from("agent_tools").select("tool_name").eq("agent_id", agentId),
  ).map((t: { tool_name: string }) => t.tool_name);

  return { ...agent, tools };
}

export async function updateAgent(tenantId: string, agentId: string, input: UpdateAgentInput): Promise<AgentWithTools> {
  const admin = supabaseAdmin();

  const patch: Record<string, unknown> = {};
  if (input.type !== undefined) patch.type = input.type;
  if (input.name !== undefined) patch.name = input.name;
  if (input.instructions !== undefined) patch.instructions = input.instructions;
  if (input.model_config !== undefined) patch.model_config = input.model_config;
  if (input.enabled !== undefined) patch.enabled = input.enabled;
  if (Object.keys(patch).length) {
    const { error } = await admin.from("agents").update(patch).eq("id", agentId).eq("tenant_id", tenantId);
    if (error) throw error;
  }

  if (input.tools) {
    const { error: delErr } = await admin.from("agent_tools").delete().eq("agent_id", agentId);
    if (delErr) throw delErr;
    if (input.tools.length) {
      const { error: insErr } = await admin.from("agent_tools").insert(
        input.tools.map((tool_name) => ({ agent_id: agentId, tool_name, config: {}, enabled: true })),
      );
      if (insErr) throw insErr;
    }
  }

  return getAgent(tenantId, agentId);
}

export async function deleteAgent(tenantId: string, agentId: string) {
  const admin = supabaseAdmin();

  // Null out references so the FK (NO ACTION) on conversations /
  // scheduled_messages doesn't block deletion, then drop the agent's own rows.
  await admin
    .from("conversations")
    .update({ agent_id: null })
    .eq("agent_id", agentId)
    .eq("tenant_id", tenantId);
  await admin
    .from("scheduled_messages")
    .update({ agent_id: null })
    .eq("agent_id", agentId)
    .eq("tenant_id", tenantId);
  await admin.from("agent_channels").delete().eq("agent_id", agentId);
  await admin.from("agent_tools").delete().eq("agent_id", agentId);

  const { error } = await admin.from("agents").delete().eq("id", agentId).eq("tenant_id", tenantId);
  if (error) throw error;
  return true;
}
