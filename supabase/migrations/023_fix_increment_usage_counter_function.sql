-- 023_fix_increment_usage_counter_function.sql
--
-- Repairs 020_fix_increment_usage_counter_params.sql, which cannot apply.
--
-- Bug 1 - it never runs. `CREATE OR REPLACE FUNCTION` refuses to rename
--   existing input parameters ("cannot change name of input parameter
--   p_tenant_id"), and 020 renames all three (p_tenant_id/p_tokens/p_cost ->
--   tenant_id/tokens/cost) to match what PostgREST passes by name. The DROP
--   has to come first.
--
-- Bug 2 - even if it had applied, the resulting function was dead on arrival.
--   PostgREST requires the bare names tenant_id/tokens/cost (see the .rpc call
--   in lib/inngest/functions/message-inbound.ts), but those names then collide
--   with the usage_counters columns inside the body, so the very first run
--   raised `column reference "tenant_id" is ambiguous` at
--   `ON CONFLICT (tenant_id, period_start, period_end)`. Every counter
--   increment silently failed (message-inbound.ts:215 only logs a warning).
--   Resolved by targeting the named unique constraint instead of column
--   names, which introduces no ambiguity at all.
--
-- Safe to apply regardless of 020's history: if 020 already applied there is
-- nothing to preserve (no grants, no dependents -- it is only ever invoked over
-- PostgREST), and if it failed the function is built here correctly.

-- Defensive: the ON CONSTRAINT target below must exist. It is created by
-- 001_initial-schema.sql, so this is a no-op in practice.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.usage_counters'::regclass
      AND conname = 'usage_counters_period_unique'
  ) THEN
    ALTER TABLE public.usage_counters
      ADD CONSTRAINT usage_counters_period_unique
      UNIQUE (tenant_id, period_start, period_end);
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.increment_usage_counter(uuid, bigint, numeric);

CREATE FUNCTION public.increment_usage_counter(
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
  ON CONFLICT ON CONSTRAINT usage_counters_period_unique
  DO UPDATE SET
    tokens_used = public.usage_counters.tokens_used + EXCLUDED.tokens_used,
    cost_usd    = public.usage_counters.cost_usd    + EXCLUDED.cost_usd,
    updated_at  = now();
END;
$$;