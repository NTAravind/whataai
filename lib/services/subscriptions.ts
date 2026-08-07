import { supabaseAdmin, unwrap } from "@/lib/clients/supabase";
import { HttpError } from "@/lib/http";

export interface SubscriptionRow {
  id: string;
  tenant_id: string;
  plan_id: string;
  status: string;
  starts_at: string;
  ends_at: string | null;
  created_by: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export const SUBSCRIPTION_STATUSES = ["active", "trialing", "past_due", "canceled", "expired"] as const;

export async function listSubscriptions(filter?: { tenant_id?: string }): Promise<SubscriptionRow[]> {
  let query = supabaseAdmin().from("subscriptions").select("*").order("created_at", { ascending: false });
  if (filter?.tenant_id) query = query.eq("tenant_id", filter.tenant_id);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as SubscriptionRow[];
}

export async function getSubscription(id: string): Promise<SubscriptionRow> {
  return unwrap<SubscriptionRow>(
    await supabaseAdmin().from("subscriptions").select("*").eq("id", id).maybeSingle(),
  );
}

async function ensurePlanExists(planId: string): Promise<void> {
  const { data } = await supabaseAdmin().from("plans").select("id, is_active").eq("id", planId).maybeSingle();
  if (!data) throw new HttpError(404, "Plan not found");
  if (!data.is_active) throw new HttpError(400, "Plan is not active");
}

export async function createSubscription(input: {
  tenant_id: string;
  plan_id: string;
  status?: string;
  starts_at?: string;
  ends_at?: string | null;
  metadata?: Record<string, unknown>;
  created_by?: string | null;
}): Promise<SubscriptionRow> {
  await ensurePlanExists(input.plan_id);
  const status = input.status ?? "active";
  if (!SUBSCRIPTION_STATUSES.includes(status as (typeof SUBSCRIPTION_STATUSES)[number])) {
    throw new HttpError(400, `Invalid status; expected one of ${SUBSCRIPTION_STATUSES.join(", ")}`);
  }

  const admin = supabaseAdmin();
  if (status === "active") {
    await admin.from("subscriptions").update({ status: "canceled" }).eq("tenant_id", input.tenant_id).eq("status", "active");
  }

  const { data, error } = await admin
    .from("subscriptions")
    .insert({
      tenant_id: input.tenant_id,
      plan_id: input.plan_id,
      status,
      starts_at: input.starts_at ?? new Date().toISOString(),
      ends_at: input.ends_at ?? null,
      metadata: input.metadata ?? {},
      created_by: input.created_by ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return data as SubscriptionRow;
}

export async function updateSubscription(
  id: string,
  input: {
    plan_id?: string;
    status?: string;
    starts_at?: string;
    ends_at?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<SubscriptionRow> {
  const patch: Record<string, unknown> = {};
  if (input.plan_id !== undefined) {
    await ensurePlanExists(input.plan_id);
    patch.plan_id = input.plan_id;
  }
  if (input.status !== undefined) {
    if (!SUBSCRIPTION_STATUSES.includes(input.status as (typeof SUBSCRIPTION_STATUSES)[number])) {
      throw new HttpError(400, `Invalid status; expected one of ${SUBSCRIPTION_STATUSES.join(", ")}`);
    }
    patch.status = input.status;
  }
  if (input.starts_at !== undefined) patch.starts_at = input.starts_at;
  if (input.ends_at !== undefined) patch.ends_at = input.ends_at;
  if (input.metadata !== undefined) patch.metadata = input.metadata;
  if (Object.keys(patch).length === 0) return getSubscription(id);

  const { data, error } = await supabaseAdmin()
    .from("subscriptions")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as SubscriptionRow;
}

export async function cancelSubscription(id: string): Promise<SubscriptionRow> {
  return updateSubscription(id, { status: "canceled" });
}

export async function deleteSubscription(id: string): Promise<void> {
  const { error } = await supabaseAdmin().from("subscriptions").delete().eq("id", id);
  if (error) throw error;
}
