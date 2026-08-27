-- Add currency preference column to tenants table
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'USD';

-- Add check constraint to ensure valid currency values
ALTER TABLE public.tenants
  ADD CONSTRAINT tenants_currency_check CHECK (currency IN ('USD', 'INR'));