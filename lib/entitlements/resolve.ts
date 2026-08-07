import { supabaseAdmin } from "@/lib/clients/supabase";

/**
 * Entitlements resolution (docs/guide.md §4).
 *
 * Resolved once per job into a small object; every downstream check
 * (`canUseAgentType`, `hasTokenBudget`, …) reads from this, never from the
 * `plans` table directly.
 */
export interface Entitlements {
  tenantId: string;
  planId: string | null;
  maxAgents: number;
  allowedAgentTypes: string[];
  allowedChannels: string[];
  tokenBudgetMonthly: number;
  model: string;
  enforcement: "hard" | "soft";
}

const DEFAULTS = {
  max_agents: 1,
  allowed_agent_types: ["receptionist"],
  allowed_channels: ["whatsapp"],
  token_budget_monthly: 100_000,
  model_tier: "default",
  enforcement: "hard",
};

export async function resolveEntitlements(tenantId: string): Promise<Entitlements> {
  const admin = supabaseAdmin();

  const { data: sub, error: subErr } = await admin
    .from("subscriptions")
    .select("plan_id, status")
    .eq("tenant_id", tenantId)
    .eq("status", "active")
    .maybeSingle();

  let limits = DEFAULTS;
  let planId: string | null = null;

  if (!subErr && sub) {
    planId = sub.plan_id;
    const { data: plan } = await admin
      .from("plans")
      .select("limits")
      .eq("id", sub.plan_id)
      .maybeSingle();
    if (plan?.limits) limits = { ...DEFAULTS, ...plan.limits };
  }

  return {
    tenantId,
    planId,
    maxAgents: limits.max_agents ?? DEFAULTS.max_agents,
    allowedAgentTypes: limits.allowed_agent_types ?? DEFAULTS.allowed_agent_types,
    allowedChannels: limits.allowed_channels ?? DEFAULTS.allowed_channels,
    tokenBudgetMonthly: limits.token_budget_monthly ?? DEFAULTS.token_budget_monthly,
    model: limits.model_tier ?? DEFAULTS.model_tier,
    enforcement: (limits.enforcement ?? DEFAULTS.enforcement) as Entitlements["enforcement"],
  };
}

/** Check the monthly token budget without bumping any counters. */
export async function hasTokenBudget(
  tenantId: string,
  entitlements: Entitlements,
): Promise<{ allowed: boolean; tokensUsed: number }> {
  const { data } = await supabaseAdmin()
    .from("usage_counters")
    .select("tokens_used")
    .eq("tenant_id", tenantId)
    .gte("period_start", new Date(new Date().toISOString().slice(0, 10)))
    .maybeSingle();

  const tokensUsed = data?.tokens_used ?? 0;
  return { allowed: tokensUsed < entitlements.tokenBudgetMonthly, tokensUsed };
}
