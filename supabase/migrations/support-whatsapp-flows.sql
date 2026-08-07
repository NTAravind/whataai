-- ============================================================================
-- 002_inngest_durability.sql
-- Additive migration on top of the base WA Agent Platform schema.
-- Adds: outbound delivery status tracking, WhatsApp Flow session state,
-- campaign schedules (mirrors Meta's /schedules API), and the idempotency
-- keys Inngest functions rely on to stay safe under at-least-once retries.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Message delivery status (webhook status callbacks: sent/delivered/read/failed)
-- ----------------------------------------------------------------------------
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'queued'
    CHECK (status = ANY (ARRAY['queued'::text,'sent'::text,'delivered'::text,'read'::text,'failed'::text])),
  ADD COLUMN IF NOT EXISTS error jsonb,
  ADD COLUMN IF NOT EXISTS inngest_event_id text; -- correlates the outbound send run for tracing

-- One row per outbound WA message id so status webhooks can UPSERT idempotently
CREATE UNIQUE INDEX IF NOT EXISTS messages_wa_message_id_unique
  ON public.messages (wa_message_id) WHERE wa_message_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 2. WhatsApp Flows: definitions + per-conversation session state
-- ----------------------------------------------------------------------------
CREATE TABLE public.flows (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  wa_account_id uuid NOT NULL,
  meta_flow_id text NOT NULL,          -- Flow ID assigned by Meta
  name text NOT NULL,
  service_id uuid,                     -- optional link into the booking engine
  status text NOT NULL DEFAULT 'draft' CHECK (status = ANY (ARRAY['draft'::text,'published'::text,'deprecated'::text])),
  public_key_pem text,                 -- our RSA public key registered with Meta
  private_key_secret_ref text,         -- pointer into secret storage, never the raw key
  screens jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT flows_pkey PRIMARY KEY (id),
  CONSTRAINT flows_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id),
  CONSTRAINT flows_wa_account_id_fkey FOREIGN KEY (wa_account_id) REFERENCES public.wa_accounts(id),
  CONSTRAINT flows_service_id_fkey FOREIGN KEY (service_id) REFERENCES public.services(id),
  CONSTRAINT flows_unique_meta_id UNIQUE (wa_account_id, meta_flow_id)
);

-- Durable, resumable state for an in-progress Flow conversation. The Flow
-- HTTP endpoint itself is synchronous (Meta calls it, waits for the reply),
-- but every state transition is journaled here so a mid-flow crash never
-- loses the customer's answers, and BACK/re-fetch always sees the last
-- committed screen.
CREATE TABLE public.flow_sessions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  flow_id uuid NOT NULL,
  flow_token text NOT NULL,
  conversation_id uuid,
  business_id uuid,
  current_screen text NOT NULL,
  collected_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  screen_history jsonb NOT NULL DEFAULT '[]'::jsonb, -- stack of prior screens for BACK
  status text NOT NULL DEFAULT 'open' CHECK (status = ANY (ARRAY['open'::text,'completed'::text,'expired'::text,'error'::text])),
  booking_id uuid, -- set once the flow completes into a confirmed booking
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT flow_sessions_pkey PRIMARY KEY (id),
  CONSTRAINT flow_sessions_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id),
  CONSTRAINT flow_sessions_flow_id_fkey FOREIGN KEY (flow_id) REFERENCES public.flows(id),
  CONSTRAINT flow_sessions_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id),
  CONSTRAINT flow_sessions_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id),
  CONSTRAINT flow_sessions_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id),
  CONSTRAINT flow_sessions_unique_token UNIQUE (flow_token)
);

CREATE INDEX flow_sessions_flow_token_idx ON public.flow_sessions (flow_token);

-- ----------------------------------------------------------------------------
-- 3. Campaign schedules — mirrors Meta's WABA /schedules resource so the
--    dashboard can list/track campaigns without round-tripping to Meta.
-- ----------------------------------------------------------------------------
CREATE TABLE public.campaign_schedules (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  wa_account_id uuid NOT NULL,
  meta_schedule_id text, -- id returned by POST /schedules, null until confirmed
  template_id uuid NOT NULL,
  audience_id text NOT NULL,   -- Meta audience/segment id
  name text NOT NULL,
  description text,
  delivery_time timestamp with time zone NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status = ANY (ARRAY['pending'::text,'scheduled'::text,'sending'::text,'completed'::text,'failed'::text,'cancelled'::text])),
  error jsonb,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT campaign_schedules_pkey PRIMARY KEY (id),
  CONSTRAINT campaign_schedules_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id),
  CONSTRAINT campaign_schedules_wa_account_id_fkey FOREIGN KEY (wa_account_id) REFERENCES public.wa_accounts(id),
  CONSTRAINT campaign_schedules_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.whatsapp_templates(id)
);

CREATE INDEX campaign_schedules_tenant_delivery_idx
  ON public.campaign_schedules (tenant_id, delivery_time);

-- ----------------------------------------------------------------------------
-- 4. RLS for new tables (same tenant-isolation pattern as the base schema)
-- ----------------------------------------------------------------------------
ALTER TABLE public.flows ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_all ON public.flows
  FOR ALL USING (tenant_id IN (SELECT public.auth_tenant_ids()) OR public.is_god_user())
  WITH CHECK (tenant_id IN (SELECT public.auth_tenant_ids()) OR public.is_god_user());

ALTER TABLE public.flow_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_all ON public.flow_sessions
  FOR ALL USING (tenant_id IN (SELECT public.auth_tenant_ids()) OR public.is_god_user())
  WITH CHECK (tenant_id IN (SELECT public.auth_tenant_ids()) OR public.is_god_user());

ALTER TABLE public.campaign_schedules ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_all ON public.campaign_schedules
  FOR ALL USING (tenant_id IN (SELECT public.auth_tenant_ids()) OR public.is_god_user())
  WITH CHECK (tenant_id IN (SELECT public.auth_tenant_ids()) OR public.is_god_user());

-- ============================================================================
-- End of migration
-- ============================================================================