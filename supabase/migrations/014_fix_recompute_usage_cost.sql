-- ============================================================================
-- 014_fix_recompute_usage_cost.sql
--
-- Bug fix: recompute_usage_counters() was hardcoding 0 for cost_usd when
-- rebuilding counters from usage_events, causing all cost data to be wiped
-- during monthly reconciliation.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.recompute_usage_counters()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_month_start date := date_trunc('month', now())::date;
  v_month_end   date := (date_trunc('month', now()) + interval '1 month' - interval '1 day')::date;
  v_count integer;
BEGIN
  -- Rebuild this month's counters from the event log to self-heal any drift.
  -- Both tokens_used and cost_usd are re-aggregated from usage_events so
  -- neither field is silently zeroed out.
  DELETE FROM public.usage_counters
    WHERE period_start = v_month_start AND period_end = v_month_end;

  INSERT INTO public.usage_counters (tenant_id, period_start, period_end, tokens_used, cost_usd)
  SELECT
    tenant_id,
    v_month_start,
    v_month_end,
    COALESCE(SUM(total_tokens), 0),
    COALESCE(SUM(cost_usd), 0)
  FROM public.usage_events
  WHERE created_at >= v_month_start AND created_at < v_month_end + 1
  GROUP BY tenant_id;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
