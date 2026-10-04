import { supabaseAdmin } from "@/lib/clients/supabase";
import { DEFAULT_MODEL } from "@/lib/agents/provider";
import type { PlanLimits } from "@/lib/services/plans";

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
  /**
   * Model ids the tenant's plan grants, as written in plans.limits. Empty means
   * the plan set no restriction. lib/agents/model-access.ts intersects this with
   * the enabled catalog and falls back to defaultModel when needed.
   */
  allowedModels: string[];
  /** The model a tenant falls back to when its selection is no longer granted. */
  defaultModel: string;
  enforcement: "hard" | "soft";
}

/** A plan's limits once DEFAULTS have filled in every missing key. */
type ResolvedLimits = Required<
  Pick<PlanLimits, "max_agents" | "allowed_agent_types" | "allowed_channels" | "token_budget_monthly" | "enforcement">
> & Pick<PlanLimits, "allowed_models" | "default_model">;

const DEFAULTS: ResolvedLimits = {
  max_agents: 1,
  allowed_agent_types: ["receptionist"],
  allowed_channels: ["whatsapp"],
  token_budget_monthly: 100_000,
  enforcement: "hard",
};

export async function resolveEntitlements(tenantId: string): Promise<Entitlements> {
  const admin = supabaseAdmin();

  const [tenantRes, subRes] = await Promise.all([
    admin.from("tenants").select("token_budget_topup").eq("id", tenantId).maybeSingle(),
    admin
      .from("subscriptions")
      .select("plan_id, status")
      .eq("tenant_id", tenantId)
      .eq("status", "active")
      .maybeSingle(),
  ]);

  const topup = tenantRes.data?.token_budget_topup ?? 0;
  const sub = subRes.data;
  const subErr = subRes.error;

  let limits: ResolvedLimits = DEFAULTS;
  let planId: string | null = null;

  if (!subErr && sub) {
    planId = sub.plan_id;
    const { data: plan } = await admin
      .from("plans")
      .select("limits")
      .eq("id", sub.plan_id)
      .maybeSingle();
    if (plan?.limits) limits = { ...DEFAULTS, ...plan.limits } as ResolvedLimits;
  }

  return {
    tenantId,
    planId,
    maxAgents: limits.max_agents,
    allowedAgentTypes: limits.allowed_agent_types,
    allowedChannels: limits.allowed_channels,
    tokenBudgetMonthly: limits.token_budget_monthly + topup,
    allowedModels: limits.allowed_models ?? [],
    defaultModel: limits.default_model ?? DEFAULT_MODEL,
    enforcement: limits.enforcement,
  };
}

/** Check the monthly token budget without bumping any counters. */
export async function hasTokenBudget(
  tenantId: string,
  entitlements: Entitlements,
): Promise<{ allowed: boolean; tokensUsed: number }> {
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await supabaseAdmin()
    .from("usage_counters")
    .select("tokens_used")
    .eq("tenant_id", tenantId)
    .lte("period_start", today)
    .gte("period_end", today)
    .maybeSingle();

  const tokensUsed = data?.tokens_used ?? 0;
  return { allowed: tokensUsed < entitlements.tokenBudgetMonthly, tokensUsed };
}
