-- Migration: add per-tenant cap on the number of businesses they can own.
-- NULL means no limit (the default for all existing tenants).
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS max_businesses integer DEFAULT NULL;
