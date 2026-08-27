-- Add cost column to usage_events so we store the dollar amount per event.
ALTER TABLE public.usage_events
  ADD COLUMN IF NOT EXISTS cost_usd numeric NOT NULL DEFAULT 0;
