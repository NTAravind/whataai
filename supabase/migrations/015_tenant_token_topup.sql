-- ============================================================================
-- 015_tenant_token_topup.sql
-- Add token_budget_topup to allow god users to give extra tokens beyond plan.
-- ============================================================================

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS token_budget_topup bigint NOT NULL DEFAULT 0;
