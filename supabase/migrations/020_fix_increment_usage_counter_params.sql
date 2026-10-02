-- Migration 020: Fix increment_usage_counter parameter names.
--
-- The existing function (003_ingest_pipeline.sql) declared parameters as
-- p_tenant_id / p_tokens / p_cost.  Supabase's PostgREST RPC maps call
-- arguments by exact name match — it looked for a function accepting
-- (cost, tenant_id, tokens) but the DB had (p_cost, p_tenant_id, p_tokens),
-- which caused:
--   "Could not find the function public.increment_usage_counter(cost, tenant_id, tokens)
--    in the schema cache"
--
-- Fix: recreate the function with parameter names that match what the
-- application passes: tenant_id, tokens, cost.

CREATE OR REPLACE FUNCTION public.increment_usage_counter(
  tenant_id uuid,
  tokens    bigint,
  cost      numeric DEFAULT 0
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.usage_counters (tenant_id, period_start, period_end, tokens_used, cost_usd)
  VALUES (
    tenant_id,
    date_trunc('month', now())::date,
    (date_trunc('month', now()) + interval '1 month' - interval '1 day')::date,
    tokens,
    cost
  )
  ON CONFLICT (tenant_id, period_start, period_end)
  DO UPDATE SET
    tokens_used = public.usage_counters.tokens_used + EXCLUDED.tokens_used,
    cost_usd    = public.usage_counters.cost_usd    + EXCLUDED.cost_usd,
    updated_at  = now();
END;
$$;
