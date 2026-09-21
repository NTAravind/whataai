import { requireTenantAccess } from "@/lib/auth/guard";
import { handleError, ok } from "@/lib/http";
import { tools } from "@/lib/agents/registry";
import { listAgents } from "@/lib/services/agents";
import { listAutomations } from "@/lib/services/automations";
import { supabaseAdmin, unwrap } from "@/lib/clients/supabase";

type Ctx = { params: Promise<{ tenantId: string }> };

/**
 * Tool registry + per-agent enablement + active ai_capture automations — the
 * builder UI's data source: which tool names are valid `trigger_config.tool_name`
 * values, and whether an agent will actually surface them.
 */
export async function GET(_request: Request, { params }: Ctx) {
  try {
    const { tenantId } = await params;
    await requireTenantAccess(tenantId);

    const [agents, automations, agentToolRows] = await Promise.all([
      listAgents(tenantId),
      listAutomations(tenantId),
      unwrap(
        await supabaseAdmin()
          .from("agent_tools")
          .select("agent_id, tool_name")
          .in("tool_name", Object.keys(tools)),
      ),
    ]);

    const byAgent = new Map<string, Set<string>>();
    for (const row of agentToolRows as { agent_id: string; tool_name: string }[]) {
      const set = byAgent.get(row.agent_id) ?? new Set<string>();
      set.add(row.tool_name);
      byAgent.set(row.agent_id, set);
    }

    return ok({
      tools: Object.entries(tools).map(([name, def]) => ({
        name,
        description: def.description,
      })),
      agents: agents.map((agent) => ({
        id: agent.id,
        name: agent.name,
        enabledTools: [...(byAgent.get(agent.id) ?? [])],
      })),
      captureAutomations: automations
        .filter((a) => a.trigger_type === "ai_capture" && a.is_active)
        .map((a) => ({
          id: a.id,
          name: a.name,
          agentId: a.agent_id,
          toolName: `capture_${a.id}`,
          fields: (a.trigger_config as { fields?: unknown[] }).fields ?? [],
        })),
    });
  } catch (e) {
    return handleError(e);
  }
}