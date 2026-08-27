import { supabaseAdmin } from "@/lib/clients/supabase";
import type { AgentToolCtx } from "@/lib/agents/registry";

export const HITL_CONTROLLED_TOOLS = new Set([
  "send_template",
  "create_booking",
  "cancel_booking",
  "trigger_flow",
  "create_template",
]);

export async function requiresApproval(
  agentId: string,
  toolName: string,
): Promise<boolean> {
  if (!HITL_CONTROLLED_TOOLS.has(toolName)) return false;

  const { data } = await supabaseAdmin()
    .from("agent_tools")
    .select("approval_required")
    .eq("agent_id", agentId)
    .eq("tool_name", toolName)
    .eq("enabled", true)
    .maybeSingle();

  return data?.approval_required ?? false;
}

export async function storePendingAction(params: {
  threadId: string;
  ctx: AgentToolCtx;
  toolName: string;
  toolArgs: Record<string, unknown>;
}) {
  await supabaseAdmin().from("agent_pending_actions").insert({
    thread_id: params.threadId,
    tenant_id: params.ctx.tenantId,
    conversation_id: params.ctx.conversationId,
    tool_name: params.toolName,
    tool_args: params.toolArgs,
    status: "pending",
  });
}

export async function approvePendingAction(
  actionId: string,
  reviewedBy?: string,
): Promise<{ success: boolean; error?: string }> {
  const { data: action, error: fetchError } = await supabaseAdmin()
    .from("agent_pending_actions")
    .select("*")
    .eq("id", actionId)
    .eq("status", "pending")
    .maybeSingle();

  if (fetchError || !action) {
    return { success: false, error: "Pending action not found or already processed." };
  }

  await supabaseAdmin()
    .from("agent_pending_actions")
    .update({
      status: "approved",
      reviewed_by: reviewedBy ?? null,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", actionId);

  return { success: true };
}

export async function rejectPendingAction(
  actionId: string,
  reason: string,
  reviewedBy?: string,
): Promise<{ success: boolean; error?: string }> {
  const { data: action, error: fetchError } = await supabaseAdmin()
    .from("agent_pending_actions")
    .select("*")
    .eq("id", actionId)
    .eq("status", "pending")
    .maybeSingle();

  if (fetchError || !action) {
    return { success: false, error: "Pending action not found or already processed." };
  }

  await supabaseAdmin()
    .from("agent_pending_actions")
    .update({
      status: "rejected",
      reviewed_by: reviewedBy ?? null,
      reviewed_at: new Date().toISOString(),
      rejection_reason: reason,
    })
    .eq("id", actionId);

  return { success: true };
}
