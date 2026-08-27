-- ============================================================================
-- 001_initial-schema.sql — Full schema (ready to run on a fresh Supabase project)
-- Now includes the universal schema-driven booking engine:
--   businesses, resources, services, service_schemas, availability_rules,
--   availability_exceptions, and a generic bookings table.
-- ============================================================================

create extension if not exists vector;
create extension if not exists pgcrypto; -- for gen_random_uuid()

-- ============================================================================
-- 1. Platform-level tables
-- ============================================================================

CREATE TABLE public.god_users (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT god_users_pkey PRIMARY KEY (id)
);

CREATE TABLE public.tenants (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  status text DEFAULT 'active'::text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT tenants_pkey PRIMARY KEY (id)
);

CREATE TABLE public.tenant_members (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id),
  role text NOT NULL DEFAULT 'member'::text CHECK (role = ANY (ARRAY['owner'::text, 'admin'::text, 'member'::text])),
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT tenant_members_pkey PRIMARY KEY (id),
  CONSTRAINT tenant_members_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id),
  CONSTRAINT tenant_members_unique UNIQUE (tenant_id, user_id)
);

CREATE TABLE public.plans (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  is_active boolean DEFAULT true,
  limits jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT plans_pkey PRIMARY KEY (id),
  CONSTRAINT plans_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.god_users(id)
);

CREATE TABLE public.subscriptions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  plan_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'active'::text,
  starts_at timestamp with time zone NOT NULL DEFAULT now(),
  ends_at timestamp with time zone,
  created_by uuid,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT subscriptions_pkey PRIMARY KEY (id),
  CONSTRAINT subscriptions_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id),
  CONSTRAINT subscriptions_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES public.plans(id),
  CONSTRAINT subscriptions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.god_users(id)
);

CREATE TABLE public.usage_counters (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  tokens_used bigint NOT NULL DEFAULT 0,
  cost_usd numeric NOT NULL DEFAULT 0,
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT usage_counters_pkey PRIMARY KEY (id),
  CONSTRAINT usage_counters_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id),
  CONSTRAINT usage_counters_period_unique UNIQUE (tenant_id, period_start, period_end)
);

CREATE TABLE public.usage_events (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  message_id uuid,
  agent_id uuid,
  prompt_tokens integer NOT NULL DEFAULT 0,
  completion_tokens integer NOT NULL DEFAULT 0,
  total_tokens integer NOT NULL DEFAULT 0,
  model text,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT usage_events_pkey PRIMARY KEY (id),
  CONSTRAINT usage_events_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id)
);

-- ============================================================================
-- 2. Channel accounts
-- ============================================================================

CREATE TABLE public.wa_accounts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  wa_phone_number_id text NOT NULL UNIQUE,
  display_phone_number text NOT NULL,
  wa_business_account_id text NOT NULL,
  status text DEFAULT 'active'::text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT wa_accounts_pkey PRIMARY KEY (id),
  CONSTRAINT wa_accounts_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id)
);

CREATE TABLE public.mail_accounts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  email_address text NOT NULL UNIQUE,
  provider text NOT NULL,
  credentials jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text DEFAULT 'active'::text,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT mail_accounts_pkey PRIMARY KEY (id),
  CONSTRAINT mail_accounts_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id)
);

CREATE TABLE public.whatsapp_templates (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  wa_account_id uuid NOT NULL,
  name text NOT NULL,
  category text NOT NULL,
  language text NOT NULL DEFAULT 'en_US'::text,
  status text NOT NULL DEFAULT 'pending'::text,
  components jsonb NOT NULL DEFAULT '[]'::jsonb,
  meta_template_id text,
  rejection_reason text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT whatsapp_templates_pkey PRIMARY KEY (id),
  CONSTRAINT whatsapp_templates_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id),
  CONSTRAINT whatsapp_templates_wa_account_id_fkey FOREIGN KEY (wa_account_id) REFERENCES public.wa_accounts(id),
  CONSTRAINT whatsapp_templates_unique UNIQUE (wa_account_id, name, language)
);

-- ============================================================================
-- 3. Contacts & Knowledge base
-- ============================================================================

CREATE TABLE public.contacts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  full_name text,
  phone_number text,
  email text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT contacts_pkey PRIMARY KEY (id),
  CONSTRAINT contacts_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id)
);

CREATE TABLE public.knowledge_base_documents (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  title text NOT NULL,
  source_type text NOT NULL DEFAULT 'manual'::text,
  storage_path text,
  raw_content text,
  status text DEFAULT 'pending'::text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT knowledge_base_documents_pkey PRIMARY KEY (id),
  CONSTRAINT knowledge_base_documents_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id)
);

-- NOTE: vector dimension matches OpenAI text-embedding-3-small (1536).
-- Change BEFORE running if you use a different embedding model.
CREATE TABLE public.knowledge_base_chunks (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  chunk_index integer NOT NULL,
  content text NOT NULL,
  embedding vector(1536),
  token_count integer,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT knowledge_base_chunks_pkey PRIMARY KEY (id),
  CONSTRAINT knowledge_base_chunks_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.knowledge_base_documents(id),
  CONSTRAINT knowledge_base_chunks_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id)
);

CREATE INDEX knowledge_base_chunks_embedding_idx
  ON public.knowledge_base_chunks
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- ============================================================================
-- 4. Agents
-- ============================================================================

CREATE TABLE public.agents (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  type text NOT NULL,
  name text NOT NULL,
  instructions text NOT NULL DEFAULT ''::text,
  model_config jsonb DEFAULT '{}'::jsonb,
  enabled boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT agents_pkey PRIMARY KEY (id),
  CONSTRAINT agents_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id)
);

CREATE TABLE public.agent_tools (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL,
  tool_name text NOT NULL, -- e.g. 'search_knowledge_base' | 'load_service_schema' |
                            -- 'check_availability' | 'create_booking' | 'escalate_to_human'
  config jsonb DEFAULT '{}'::jsonb,
  enabled boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT agent_tools_pkey PRIMARY KEY (id),
  CONSTRAINT agent_tools_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES public.agents(id),
  CONSTRAINT agent_tools_unique UNIQUE (agent_id, tool_name)
);

CREATE TABLE public.agent_channels (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL,
  channel text NOT NULL CHECK (channel = ANY (ARRAY['whatsapp'::text, 'mail'::text])),
  wa_account_id uuid,
  mail_account_id uuid,
  enabled boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT agent_channels_pkey PRIMARY KEY (id),
  CONSTRAINT agent_channels_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES public.agents(id),
  CONSTRAINT agent_channels_wa_account_id_fkey FOREIGN KEY (wa_account_id) REFERENCES public.wa_accounts(id),
  CONSTRAINT agent_channels_mail_account_id_fkey FOREIGN KEY (mail_account_id) REFERENCES public.mail_accounts(id)
);

-- ============================================================================
-- 5. Conversations & Messages
-- ============================================================================

CREATE TABLE public.conversations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  contact_id uuid NOT NULL,
  agent_id uuid,
  channel text NOT NULL CHECK (channel = ANY (ARRAY['whatsapp'::text, 'mail'::text])),
  wa_account_id uuid,
  mail_account_id uuid,
  status text DEFAULT 'active'::text,
  last_message_at timestamp with time zone,
  unread_count integer NOT NULL DEFAULT 0,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT conversations_pkey PRIMARY KEY (id),
  CONSTRAINT conversations_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id),
  CONSTRAINT conversations_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id),
  CONSTRAINT conversations_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES public.agents(id),
  CONSTRAINT conversations_wa_account_id_fkey FOREIGN KEY (wa_account_id) REFERENCES public.wa_accounts(id),
  CONSTRAINT conversations_mail_account_id_fkey FOREIGN KEY (mail_account_id) REFERENCES public.mail_accounts(id)
);

CREATE INDEX conversations_tenant_last_message_idx
  ON public.conversations (tenant_id, last_message_at DESC);

CREATE TABLE public.messages (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL,
  role text NOT NULL CHECK (role = ANY (ARRAY['user'::text, 'assistant'::text, 'system'::text, 'tool'::text])),
  content jsonb NOT NULL,
  wa_message_id text,
  mail_message_id text,
  prompt_tokens integer,
  completion_tokens integer,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT messages_pkey PRIMARY KEY (id),
  CONSTRAINT messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id)
);

CREATE INDEX messages_conversation_created_idx
  ON public.messages (conversation_id, created_at);

-- ============================================================================
-- 6. Universal Schema-Driven Booking Engine
-- ============================================================================

-- `businesses` is kept distinct from `tenants` (even though it's 1:1 for MVP)
-- so a tenant can later run multiple locations/brands without a schema change.
CREATE TABLE public.businesses (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  name text NOT NULL,
  industry text, -- free text label for dashboard/UX only, never branched on in code
  timezone text NOT NULL DEFAULT 'UTC'::text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT businesses_pkey PRIMARY KEY (id),
  CONSTRAINT businesses_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id)
);

-- The bookable unit: a staff member, room, table, vehicle, equipment,
-- or a class session. `type` is free text (no CHECK constraint) so new
-- resource types never require a migration.
CREATE TABLE public.resources (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL,
  type text NOT NULL, -- 'staff' | 'room' | 'table' | 'vehicle' | 'equipment' | 'class' | 'none' | custom
  name text NOT NULL,
  capacity integer,
  metadata jsonb DEFAULT '{}'::jsonb,
  enabled boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT resources_pkey PRIMARY KEY (id),
  CONSTRAINT resources_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id)
);

-- The "thing" being booked: a consultation, a room-night, a haircut,
-- a class, a table reservation, a rental period.
CREATE TABLE public.services (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL,
  name text NOT NULL,
  description text,
  booking_mode text NOT NULL DEFAULT 'duration'::text
    CHECK (booking_mode = ANY (ARRAY['fixed_slot'::text, 'duration'::text, 'multi_day'::text, 'open'::text])),
  default_duration_minutes integer,
  requires_resource_type text, -- nullable — matches resources.type, or null if unresourced
  active_schema_id uuid, -- FK added after service_schemas is created (circular dependency)
  enabled boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT services_pkey PRIMARY KEY (id),
  CONSTRAINT services_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id)
);

-- The JSON schema that drives both validation and the AI conversation.
-- Versioned so schema edits don't retroactively change in-flight bookings'
-- interpretation of already-collected data.
CREATE TABLE public.service_schemas (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  service_id uuid NOT NULL,
  version integer NOT NULL DEFAULT 1,
  -- Shape: { "fields": [ { id, label, type, required, placeholder,
  --   validation, options, role, ai: { question, confirmation,
  --   extraction_hints, examples, retry_prompt, relative_date_support,
  --   ambiguity_resolution }, visible_if, required_if }, ... ] }
  schema jsonb NOT NULL DEFAULT '{"fields": []}'::jsonb,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT service_schemas_pkey PRIMARY KEY (id),
  CONSTRAINT service_schemas_service_id_fkey FOREIGN KEY (service_id) REFERENCES public.services(id),
  CONSTRAINT service_schemas_unique_version UNIQUE (service_id, version)
);

ALTER TABLE public.services
  ADD CONSTRAINT services_active_schema_id_fkey
  FOREIGN KEY (active_schema_id) REFERENCES public.service_schemas(id);

-- Recurring open hours, per resource (or per business if the service is
-- unresourced, e.g. a walk-in-style service with no dedicated staff/room).
CREATE TABLE public.availability_rules (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL,
  resource_id uuid, -- nullable: applies to the whole business if null
  day_of_week integer NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0 = Sunday
  start_time time NOT NULL,
  end_time time NOT NULL,
  timezone text NOT NULL DEFAULT 'UTC'::text,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT availability_rules_pkey PRIMARY KEY (id),
  CONSTRAINT availability_rules_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id),
  CONSTRAINT availability_rules_resource_id_fkey FOREIGN KEY (resource_id) REFERENCES public.resources(id)
);

-- One-off overrides: holidays, staff leave, fully-booked blocks.
CREATE TABLE public.availability_exceptions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL,
  resource_id uuid, -- nullable: applies to the whole business if null
  date date NOT NULL,
  start_time time, -- nullable: null + is_closed=true means the whole day
  end_time time,
  is_closed boolean DEFAULT true,
  reason text,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT availability_exceptions_pkey PRIMARY KEY (id),
  CONSTRAINT availability_exceptions_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id),
  CONSTRAINT availability_exceptions_resource_id_fkey FOREIGN KEY (resource_id) REFERENCES public.resources(id)
);

CREATE INDEX availability_exceptions_business_date_idx
  ON public.availability_exceptions (business_id, date);

-- The ONE generic booking record for every industry. booking_data holds
-- every answer collected during the AI conversation, keyed by field id
-- from the active service_schema at the time of booking.
CREATE TABLE public.bookings (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  business_id uuid NOT NULL,
  resource_id uuid, -- nullable: 'open' or unresourced booking_mode services
  service_id uuid NOT NULL,
  service_schema_id uuid, -- snapshot of which schema version was used
  customer_id uuid, -- nullable, → contacts
  conversation_id uuid,
  start_time timestamp with time zone NOT NULL,
  end_time timestamp with time zone,
  timezone text NOT NULL DEFAULT 'UTC'::text,
  status text NOT NULL DEFAULT 'pending'::text
    CHECK (status = ANY (ARRAY['pending'::text, 'confirmed'::text, 'cancelled'::text, 'completed'::text, 'no_show'::text])),
  booking_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT bookings_pkey PRIMARY KEY (id),
  CONSTRAINT bookings_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id),
  CONSTRAINT bookings_business_id_fkey FOREIGN KEY (business_id) REFERENCES public.businesses(id),
  CONSTRAINT bookings_resource_id_fkey FOREIGN KEY (resource_id) REFERENCES public.resources(id),
  CONSTRAINT bookings_service_id_fkey FOREIGN KEY (service_id) REFERENCES public.services(id),
  CONSTRAINT bookings_service_schema_id_fkey FOREIGN KEY (service_schema_id) REFERENCES public.service_schemas(id),
  CONSTRAINT bookings_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.contacts(id),
  CONSTRAINT bookings_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id)
);

CREATE INDEX bookings_tenant_start_time_idx
  ON public.bookings (tenant_id, start_time);

-- Fast conflict lookups for check_availability: overlapping bookings on
-- a given resource within a time range.
CREATE INDEX bookings_resource_time_idx
  ON public.bookings (resource_id, start_time, end_time)
  WHERE resource_id IS NOT NULL AND status IN ('pending', 'confirmed');

-- ============================================================================
-- 7. Webhook idempotency
-- ============================================================================

CREATE TABLE public.webhook_events (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid,
  channel text NOT NULL CHECK (channel = ANY (ARRAY['whatsapp'::text, 'mail'::text])),
  provider_event_id text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'received'::text,
  error text,
  created_at timestamp with time zone DEFAULT now(),
  processed_at timestamp with time zone,
  CONSTRAINT webhook_events_pkey PRIMARY KEY (id),
  CONSTRAINT webhook_events_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id),
  CONSTRAINT webhook_events_unique UNIQUE (channel, provider_event_id)
);

-- ============================================================================
-- 8. Row Level Security
-- ============================================================================

CREATE OR REPLACE FUNCTION public.auth_tenant_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT tenant_id FROM public.tenant_members WHERE user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.is_god_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.god_users
    WHERE email = (SELECT auth.jwt() ->> 'email')
  );
$$;

-- ---- tenants ---------------------------------------------------------------
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON public.tenants
  FOR SELECT USING (id IN (SELECT public.auth_tenant_ids()) OR public.is_god_user());

CREATE POLICY god_manage_insert ON public.tenants
  FOR INSERT WITH CHECK (public.is_god_user());

CREATE POLICY tenant_isolation_update ON public.tenants
  FOR UPDATE USING (id IN (SELECT public.auth_tenant_ids()) OR public.is_god_user());

CREATE POLICY god_manage_delete ON public.tenants
  FOR DELETE USING (public.is_god_user());

-- ---- tenant_members ---------------------------------------------------------
ALTER TABLE public.tenant_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON public.tenant_members
  FOR SELECT USING (tenant_id IN (SELECT public.auth_tenant_ids()) OR public.is_god_user());

CREATE POLICY tenant_isolation_insert ON public.tenant_members
  FOR INSERT WITH CHECK (tenant_id IN (SELECT public.auth_tenant_ids()) OR public.is_god_user());

CREATE POLICY tenant_isolation_update ON public.tenant_members
  FOR UPDATE USING (tenant_id IN (SELECT public.auth_tenant_ids()) OR public.is_god_user());

CREATE POLICY tenant_isolation_delete ON public.tenant_members
  FOR DELETE USING (tenant_id IN (SELECT public.auth_tenant_ids()) OR public.is_god_user());

-- ---- plans / subscriptions ---------------------------------------------------
ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY authenticated_read ON public.plans
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY god_manage_all ON public.plans
  FOR ALL USING (public.is_god_user()) WITH CHECK (public.is_god_user());

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON public.subscriptions
  FOR SELECT USING (tenant_id IN (SELECT public.auth_tenant_ids()) OR public.is_god_user());

CREATE POLICY god_manage_write ON public.subscriptions
  FOR ALL USING (public.is_god_user()) WITH CHECK (public.is_god_user());

-- ---- usage_counters / usage_events --------------------------------------------
ALTER TABLE public.usage_counters ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON public.usage_counters
  FOR SELECT USING (tenant_id IN (SELECT public.auth_tenant_ids()) OR public.is_god_user());

ALTER TABLE public.usage_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON public.usage_events
  FOR SELECT USING (tenant_id IN (SELECT public.auth_tenant_ids()) OR public.is_god_user());

-- ---- wa_accounts / mail_accounts / whatsapp_templates -------------------------
ALTER TABLE public.wa_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_all ON public.wa_accounts
  FOR ALL USING (tenant_id IN (SELECT public.auth_tenant_ids()) OR public.is_god_user())
  WITH CHECK (tenant_id IN (SELECT public.auth_tenant_ids()) OR public.is_god_user());

ALTER TABLE public.mail_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_all ON public.mail_accounts
  FOR ALL USING (tenant_id IN (SELECT public.auth_tenant_ids()) OR public.is_god_user())
  WITH CHECK (tenant_id IN (SELECT public.auth_tenant_ids()) OR public.is_god_user());

ALTER TABLE public.whatsapp_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_all ON public.whatsapp_templates
  FOR ALL USING (tenant_id IN (SELECT public.auth_tenant_ids()) OR public.is_god_user())
  WITH CHECK (tenant_id IN (SELECT public.auth_tenant_ids()) OR public.is_god_user());

-- ---- contacts -----------------------------------------------------------------
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_all ON public.contacts
  FOR ALL USING (tenant_id IN (SELECT public.auth_tenant_ids()) OR public.is_god_user())
  WITH CHECK (tenant_id IN (SELECT public.auth_tenant_ids()) OR public.is_god_user());

-- ---- knowledge_base_documents / knowledge_base_chunks -------------------------
ALTER TABLE public.knowledge_base_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_all ON public.knowledge_base_documents
  FOR ALL USING (tenant_id IN (SELECT public.auth_tenant_ids()) OR public.is_god_user())
  WITH CHECK (tenant_id IN (SELECT public.auth_tenant_ids()) OR public.is_god_user());

ALTER TABLE public.knowledge_base_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_all ON public.knowledge_base_chunks
  FOR ALL USING (tenant_id IN (SELECT public.auth_tenant_ids()) OR public.is_god_user())
  WITH CHECK (tenant_id IN (SELECT public.auth_tenant_ids()) OR public.is_god_user());

-- ---- agents / agent_tools / agent_channels -------------------------------------
ALTER TABLE public.agents ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_all ON public.agents
  FOR ALL USING (tenant_id IN (SELECT public.auth_tenant_ids()) OR public.is_god_user())
  WITH CHECK (tenant_id IN (SELECT public.auth_tenant_ids()) OR public.is_god_user());

ALTER TABLE public.agent_tools ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_all ON public.agent_tools
  FOR ALL USING (
    agent_id IN (SELECT id FROM public.agents WHERE tenant_id IN (SELECT public.auth_tenant_ids()))
    OR public.is_god_user()
  )
  WITH CHECK (
    agent_id IN (SELECT id FROM public.agents WHERE tenant_id IN (SELECT public.auth_tenant_ids()))
    OR public.is_god_user()
  );

ALTER TABLE public.agent_channels ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_all ON public.agent_channels
  FOR ALL USING (
    agent_id IN (SELECT id FROM public.agents WHERE tenant_id IN (SELECT public.auth_tenant_ids()))
    OR public.is_god_user()
  )
  WITH CHECK (
    agent_id IN (SELECT id FROM public.agents WHERE tenant_id IN (SELECT public.auth_tenant_ids()))
    OR public.is_god_user()
  );

-- ---- conversations / messages ---------------------------------------------------
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_all ON public.conversations
  FOR ALL USING (tenant_id IN (SELECT public.auth_tenant_ids()) OR public.is_god_user())
  WITH CHECK (tenant_id IN (SELECT public.auth_tenant_ids()) OR public.is_god_user());

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_all ON public.messages
  FOR ALL USING (
    conversation_id IN (SELECT id FROM public.conversations WHERE tenant_id IN (SELECT public.auth_tenant_ids()))
    OR public.is_god_user()
  )
  WITH CHECK (
    conversation_id IN (SELECT id FROM public.conversations WHERE tenant_id IN (SELECT public.auth_tenant_ids()))
    OR public.is_god_user()
  );

-- ---- businesses / resources / services / service_schemas ------------------------
ALTER TABLE public.businesses ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_all ON public.businesses
  FOR ALL USING (tenant_id IN (SELECT public.auth_tenant_ids()) OR public.is_god_user())
  WITH CHECK (tenant_id IN (SELECT public.auth_tenant_ids()) OR public.is_god_user());

ALTER TABLE public.resources ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_all ON public.resources
  FOR ALL USING (
    business_id IN (SELECT id FROM public.businesses WHERE tenant_id IN (SELECT public.auth_tenant_ids()))
    OR public.is_god_user()
  )
  WITH CHECK (
    business_id IN (SELECT id FROM public.businesses WHERE tenant_id IN (SELECT public.auth_tenant_ids()))
    OR public.is_god_user()
  );

ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_all ON public.services
  FOR ALL USING (
    business_id IN (SELECT id FROM public.businesses WHERE tenant_id IN (SELECT public.auth_tenant_ids()))
    OR public.is_god_user()
  )
  WITH CHECK (
    business_id IN (SELECT id FROM public.businesses WHERE tenant_id IN (SELECT public.auth_tenant_ids()))
    OR public.is_god_user()
  );

ALTER TABLE public.service_schemas ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_all ON public.service_schemas
  FOR ALL USING (
    service_id IN (
      SELECT s.id FROM public.services s
      JOIN public.businesses b ON b.id = s.business_id
      WHERE b.tenant_id IN (SELECT public.auth_tenant_ids())
    )
    OR public.is_god_user()
  )
  WITH CHECK (
    service_id IN (
      SELECT s.id FROM public.services s
      JOIN public.businesses b ON b.id = s.business_id
      WHERE b.tenant_id IN (SELECT public.auth_tenant_ids())
    )
    OR public.is_god_user()
  );

-- ---- availability_rules / availability_exceptions --------------------------------
ALTER TABLE public.availability_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_all ON public.availability_rules
  FOR ALL USING (
    business_id IN (SELECT id FROM public.businesses WHERE tenant_id IN (SELECT public.auth_tenant_ids()))
    OR public.is_god_user()
  )
  WITH CHECK (
    business_id IN (SELECT id FROM public.businesses WHERE tenant_id IN (SELECT public.auth_tenant_ids()))
    OR public.is_god_user()
  );

ALTER TABLE public.availability_exceptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_all ON public.availability_exceptions
  FOR ALL USING (
    business_id IN (SELECT id FROM public.businesses WHERE tenant_id IN (SELECT public.auth_tenant_ids()))
    OR public.is_god_user()
  )
  WITH CHECK (
    business_id IN (SELECT id FROM public.businesses WHERE tenant_id IN (SELECT public.auth_tenant_ids()))
    OR public.is_god_user()
  );

-- ---- bookings -----------------------------------------------------------------
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_all ON public.bookings
  FOR ALL USING (tenant_id IN (SELECT public.auth_tenant_ids()) OR public.is_god_user())
  WITH CHECK (tenant_id IN (SELECT public.auth_tenant_ids()) OR public.is_god_user());

-- ---- webhook_events -------------------------------------------------------------
ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON public.webhook_events
  FOR SELECT USING (tenant_id IN (SELECT public.auth_tenant_ids()) OR public.is_god_user());

-- ---- god_users --------------------------------------------------------------------
ALTER TABLE public.god_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY god_self_read ON public.god_users
  FOR SELECT USING (public.is_god_user());

-- ============================================================================
-- End of schema
-- ============================================================================
