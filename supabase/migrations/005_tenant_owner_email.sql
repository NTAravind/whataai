-- Migration 005: store the tenant owner's email directly on the tenant row
-- (denormalized from auth.users for cheap admin-UI display)

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS owner_email text;
