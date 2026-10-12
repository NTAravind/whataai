ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS booking_context jsonb;
