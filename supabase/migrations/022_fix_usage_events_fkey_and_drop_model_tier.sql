-- 022_fix_usage_events_fkey_and_drop_model_tier.sql
--
-- Two corrections, both written idempotently because 001-020 are already
-- applied to live databases and must not be edited (that would break
-- supabase_migrations.schema_migrations checksums).
--
-- 1. 003_ingest_pipeline.sql:80 used `ALTER TABLE ... ADD CONSTRAINT IF NOT
--    EXISTS`, which Postgres has never supported (only ADD COLUMN, CREATE INDEX
--    and CREATE TABLE accept IF NOT EXISTS). The statement aborts, so on any
--    database provisioned straight from 003 the FK below was never created.
--    Re-create it guarded by a catalog lookup.
--
-- 2. Drop the dead `model_tier` limit. It had three conflicting vocabularies
--    (admin UI wrote economy|standard|premium, resolve.ts defaulted "default",
--    docs said "pro"), nothing ever read it for enforcement, and
--    plans.limits.allowed_models + default_model replace it.

-- ---------------------------------------------------------------------------
-- 1. usage_events.conversation_id FK
-- ---------------------------------------------------------------------------
ALTER TABLE public.usage_events
  ADD COLUMN IF NOT EXISTS conversation_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'usage_events_conversation_id_fkey'
      AND conrelid = 'public.usage_events'::regclass
  ) THEN
    ALTER TABLE public.usage_events
      ADD CONSTRAINT usage_events_conversation_id_fkey
      FOREIGN KEY (conversation_id) REFERENCES public.conversations(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS usage_events_conversation_idx
  ON public.usage_events (conversation_id);

-- ---------------------------------------------------------------------------
-- 2. Retire model_tier
-- ---------------------------------------------------------------------------
UPDATE public.plans
SET limits = limits - 'model_tier',
    updated_at = now()
WHERE limits ? 'model_tier';