import { requireTenantAccess } from "@/lib/auth/guard";
import { handleError, ok } from "@/lib/http";
import { supabaseAdmin } from "@/lib/clients/supabase";

type Ctx = { params: Promise<{ tenantId: string }> };

export interface UsageCounterRow {
  id: string;
  tenant_id: string;
  period_start: string;
  period_end: string;
  tokens_used: number;
  cost_usd: number;
  updated_at: string;
}

export interface UsageEventRow {
  id: string;
  tenant_id: string;
  message_id: string | null;
  agent_id: string | null;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  model: string | null;
  created_at: string;
}

export async function GET(_request: Request, { params }: Ctx) {
  try {
    const { tenantId } = await params;
    await requireTenantAccess(tenantId);
    const admin = supabaseAdmin();

    const today = new Date().toISOString().slice(0, 10);
    const { data: counter } = await admin
      .from("usage_counters")
      .select("*")
      .eq("tenant_id", tenantId)
      .lte("period_start", today)
      .gte("period_end", today)
      .maybeSingle();

    const { data: events } = await admin
      .from("usage_events")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(50);

    return ok({
      counter: (counter as UsageCounterRow | null) ?? null,
      events: (events ?? []) as UsageEventRow[],
    });
  } catch (e) {
    return handleError(e);
  }
}
