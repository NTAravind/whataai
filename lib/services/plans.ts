import { z } from "zod";
import { supabaseAdmin, unwrap } from "@/lib/clients/supabase";
import { HttpError } from "@/lib/http";

export interface PlanRow {
  id: string;
  name: string;
  is_active: boolean;
  limits: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface PlanLimits {
  max_agents?: number;
  max_wa_accounts?: number;
  allowed_agent_types?: string[];
  allowed_channels?: string[];
  token_budget_monthly?: number;
  model_tier?: string;
  enforcement?: "hard" | "soft";
}

/** Canonical `plans.limits` shape (docs/guide.md §3) — keep in sync with resolve.ts DEFAULTS. */
export const planLimitsSchema = z
  .object({
    max_agents: z.number().int().min(0).optional(),
    max_wa_accounts: z.number().int().min(0).optional(),
    allowed_agent_types: z.array(z.string().min(1)).optional(),
    allowed_channels: z.array(z.string().min(1)).optional(),
    token_budget_monthly: z.number().int().min(0).optional(),
    model_tier: z.string().min(1).optional(),
    enforcement: z.enum(["hard", "soft"]).optional(),
  })
  .strip();

export async function listPlans(activeOnly = false): Promise<PlanRow[]> {
  let query = supabaseAdmin().from("plans").select("*").order("created_at", { ascending: false });
  if (activeOnly) query = query.eq("is_active", true);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as PlanRow[];
}

export async function getPlan(id: string): Promise<PlanRow> {
  return unwrap<PlanRow>(
    await supabaseAdmin().from("plans").select("*").eq("id", id).maybeSingle(),
  );
}

export async function createPlan(
  input: { name: string; limits?: PlanLimits; is_active?: boolean; created_by?: string | null },
): Promise<PlanRow> {
  const limits = planLimitsSchema.parse(input.limits ?? {});
  const { data, error } = await supabaseAdmin()
    .from("plans")
    .insert({
      name: input.name,
      limits,
      is_active: input.is_active ?? true,
      created_by: input.created_by ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return data as PlanRow;
}

export async function updatePlan(
  id: string,
  input: { name?: string; limits?: PlanLimits; is_active?: boolean },
): Promise<PlanRow> {
  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.limits !== undefined) patch.limits = planLimitsSchema.parse(input.limits);
  if (input.is_active !== undefined) patch.is_active = input.is_active;
  if (Object.keys(patch).length === 0) return getPlan(id);

  const { data, error } = await supabaseAdmin()
    .from("plans")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as PlanRow;
}

export async function deletePlan(id: string): Promise<void> {
  const { data: subs, error: subErr } = await supabaseAdmin()
    .from("subscriptions")
    .select("id")
    .eq("plan_id", id)
    .limit(1);
  if (subErr) throw subErr;
  if ((subs ?? []).length > 0) {
    throw new HttpError(409, "Plan is in use by at least one subscription; cancel those first");
  }
  const { error } = await supabaseAdmin().from("plans").delete().eq("id", id);
  if (error) throw error;
}
