-- ============================================================================
-- 003_ingest_pipeline.sql
-- Additive migration for the Inngest webhook-ingest + orchestration pipeline.
-- Builds on 001 (base schema) and 002 (flows / schedules / delivery status).
--
-- What this adds:
--   * webhook_events: event_type scoping + inngest_run_id for durable claims
--   * conversations: last_inbound_at (session-window pricing decisions)
--   * contacts: opt_out + dedupe index by phone
--   * whatsapp_templates: Meta template metadata (sub_category, quality_score…)
--   * campaign_schedules: waba_cs_id + template_params
--   * usage_events: conversation_id for per-conversation cost views
--   * scheduled_messages: durable record of future outbound sends (Inngest
--     sleepUntil / event `ts` handles the actual timing; this row is the
--     dashboard-facing source of truth and survives app restarts)
--   * bookings: reminder_sent_at for the booking.reminder cron
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. webhook_events — scope idempotency per event type (message vs status
--    share the same Meta wamid) and record the Inngest run that claimed it.
-- ----------------------------------------------------------------------------
ALTER TABLE public.webhook_events
  DROP CONSTRAINT IF EXISTS webhook_events_unique;

ALTER TABLE public.webhook_events
  ADD COLUMN IF NOT EXISTS event_type text NOT NULL DEFAULT 'message'
    CHECK (event_type = ANY (ARRAY['message'::text, 'status'::text, 'flow'::text, 'template'::text])),
  ADD COLUMN IF NOT EXISTS inngest_run_id text;

CREATE UNIQUE INDEX IF NOT EXISTS webhook_events_channel_type_event_unique
  ON public.webhook_events (channel, event_type, provider_event_id);

-- ----------------------------------------------------------------------------
-- 2. conversations — last_inbound_at drives WhatsApp message-tier selection
--    (free 24h customer-service window vs paid utility/service templates).
-- ----------------------------------------------------------------------------
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS last_inbound_at timestamp with time zone;

CREATE INDEX IF NOT EXISTS conversations_tenant_inbound_idx
  ON public.conversations (tenant_id, last_inbound_at DESC NULLS LAST);

-- ----------------------------------------------------------------------------
-- 3. contacts — opt-out flag (Meta STOP/UNSUBSCRIBE compliance) + phone dedupe.
-- ----------------------------------------------------------------------------
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS opt_out boolean NOT NULL DEFAULT false;

-- Plain (non-partial) unique index: Postgres treats NULLs as distinct, so
-- contacts without a phone number never conflict. postgREST on_conflict can
-- infer this index for INSERT ... ON CONFLICT (partial indexes can't).
CREATE UNIQUE INDEX IF NOT EXISTS contacts_tenant_phone_unique
  ON public.contacts (tenant_id, phone_number);

-- ----------------------------------------------------------------------------
-- 4. whatsapp_templates — mirror Meta's template metadata fields.
-- ----------------------------------------------------------------------------
ALTER TABLE public.whatsapp_templates
  ADD COLUMN IF NOT EXISTS sub_category text,
  ADD COLUMN IF NOT EXISTS parameter_format text DEFAULT 'NAMED'::text,
  ADD COLUMN IF NOT EXISTS message_send_ttl_seconds integer,
  ADD COLUMN IF NOT EXISTS quality_score jsonb,
  ADD COLUMN IF NOT EXISTS source text DEFAULT 'manual'::text;

-- ----------------------------------------------------------------------------
-- 5. campaign_schedules — Meta /schedules fields.
-- ----------------------------------------------------------------------------
ALTER TABLE public.campaign_schedules
  ADD COLUMN IF NOT EXISTS waba_cs_id text,
  ADD COLUMN IF NOT EXISTS template_params jsonb NOT NULL DEFAULT '{}'::jsonb;

-- ----------------------------------------------------------------------------
-- 6. usage_events — per-conversation attribution.
-- ----------------------------------------------------------------------------
ALTER TABLE public.usage_events
  ADD COLUMN IF NOT EXISTS conversation_id uuid;

ALTER TABLE public.usage_events
  ADD CONSTRAINT IF NOT EXISTS usage_events_conversation_id_fkey
  FOREIGN KEY (conversation_id) REFERENCES public.conversations(id);

CREATE INDEX IF NOT EXISTS usage_events_conversation_idx
  ON public.usage_events (conversation_id);

-- ----------------------------------------------------------------------------
-- 7. scheduled_messages — dashboard-facing record for delayed outbound sends.
--    The Inngest `schedule/message.run` function performs the actual send;
--    the `ts` field on the emitted event drives the timing durably.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.scheduled_messages (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  conversation_id uuid,
  contact_id uuid NOT NULL,
  agent_id uuid,
  channel text NOT NULL CHECK (channel = ANY (ARRAY['whatsapp'::text, 'mail'::text])),
  wa_account_id uuid,
  mail_account_id uuid,
  template_id uuid,                       -- set when sending a template message
  content_type text NOT NULL DEFAULT 'text'
    CHECK (content_type = ANY (ARRAY['text'::text, 'template'::text])),
  content jsonb NOT NULL DEFAULT '{}'::jsonb, -- { text } or { name, language, components }
  send_at timestamp with time zone NOT NULL,
  status text NOT NULL DEFAULT 'scheduled'
    CHECK (status = ANY (ARRAY['scheduled'::text, 'sent'::text, 'failed'::text, 'cancelled'::text])),
  inngest_run_id text,
  error jsonb,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT scheduled_messages_pkey PRIMARY KEY (id),
  CONSTRAINT scheduled_messages_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id),
  CONSTRAINT scheduled_messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id),
  CONSTRAINT scheduled_messages_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id),
  CONSTRAINT scheduled_messages_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES public.agents(id),
  CONSTRAINT scheduled_messages_wa_account_id_fkey FOREIGN KEY (wa_account_id) REFERENCES public.wa_accounts(id),
  CONSTRAINT scheduled_messages_mail_account_id_fkey FOREIGN KEY (mail_account_id) REFERENCES public.mail_accounts(id),
  CONSTRAINT scheduled_messages_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.whatsapp_templates(id)
);

CREATE INDEX IF NOT EXISTS scheduled_messages_tenant_status_idx
  ON public.scheduled_messages (tenant_id, status);

CREATE INDEX IF NOT EXISTS scheduled_messages_send_at_idx
  ON public.scheduled_messages (send_at);

-- ----------------------------------------------------------------------------
-- 8. knowledge_base_chunks — full-text search index for the MVP retrieval
--    path. (pgvector remains the long-term path; FTS needs no embedding
--    model/dimension configuration and works out of the box.)
-- ----------------------------------------------------------------------------
ALTER TABLE public.knowledge_base_chunks
  ADD COLUMN IF NOT EXISTS content_tsv tsvector
    GENERATED ALWAYS AS (to_tsvector('english', content)) STORED;

CREATE INDEX IF NOT EXISTS knowledge_base_chunks_tsv_idx
  ON public.knowledge_base_chunks USING gin (content_tsv);

-- ----------------------------------------------------------------------------
-- 9. bookings — reminder bookkeeping for the booking.reminder cron.
-- ----------------------------------------------------------------------------
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS reminder_sent_at timestamp with time zone;

-- ----------------------------------------------------------------------------
-- 9. RLS
-- ----------------------------------------------------------------------------
ALTER TABLE public.scheduled_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_all ON public.scheduled_messages
  FOR ALL USING (tenant_id IN (SELECT public.auth_tenant_ids()) OR public.is_god_user())
  WITH CHECK (tenant_id IN (SELECT public.auth_tenant_ids()) OR public.is_god_user());

-- webhook_events: allow authenticated tenants to see their own + god users;
-- inserts happen server-side via the service role (which bypasses RLS).
DROP POLICY IF EXISTS tenant_isolation_select ON public.webhook_events;
CREATE POLICY tenant_isolation_select ON public.webhook_events
  FOR SELECT USING (tenant_id IN (SELECT public.auth_tenant_ids()) OR public.is_god_user());

-- ----------------------------------------------------------------------------
-- 10. Usage RPCs — idempotent counter increments + self-healing reconcile.
--     Usage writes happen from Inngest steps (retried), so increments must be
--     additive and atomic (never read-then-write from app code).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.increment_usage_counter(
  p_tenant_id uuid,
  p_tokens bigint,
  p_cost numeric DEFAULT 0
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.usage_counters (tenant_id, period_start, period_end, tokens_used, cost_usd)
  VALUES (
    p_tenant_id,
    date_trunc('month', now())::date,
    (date_trunc('month', now()) + interval '1 month' - interval '1 day')::date,
    p_tokens,
    p_cost
  )
  ON CONFLICT (tenant_id, period_start, period_end)
  DO UPDATE SET
    tokens_used = public.usage_counters.tokens_used + EXCLUDED.tokens_used,
    cost_usd = public.usage_counters.cost_usd + EXCLUDED.cost_usd,
    updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.recompute_usage_counters()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_month_start date := date_trunc('month', now())::date;
  v_month_end date := (date_trunc('month', now()) + interval '1 month' - interval '1 day')::date;
  v_count integer;
BEGIN
  -- Rebuild this month's counters from the event log to self-heal drift
  -- caused by failed steps between the increment RPC and usage_events insert.
  DELETE FROM public.usage_counters
    WHERE period_start = v_month_start AND period_end = v_month_end;

  INSERT INTO public.usage_counters (tenant_id, period_start, period_end, tokens_used, cost_usd)
  SELECT tenant_id, v_month_start, v_month_end, SUM(total_tokens), 0
  FROM public.usage_events
  WHERE created_at >= v_month_start AND created_at < v_month_end + 1
  GROUP BY tenant_id;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- ============================================================================
-- End of migration
-- ============================================================================
