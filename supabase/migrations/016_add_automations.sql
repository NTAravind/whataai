-- 016_add_automations.sql
--
-- Custom Automations ("automations") — a tenant can build a chain of steps
-- (API calls, WhatsApp sends, tagging, waits) that fire after the agent
-- replies, after a specific tool call, on AI field capture, or manually.
-- Unrelated to WhatsApp's native Flows, which live in `flows`/`flow_sessions`.
--
-- Tables added here have no cascading deletes — tenant teardown must delete
-- in FK order deepest-first (see TENANT_DELETE_ORDER in lib/services/tenants.ts).

-- ---------------------------------------------------------------------------
-- integrations — an external service (webhook, Zoho, QuickBooks, Stripe, ...)
-- ---------------------------------------------------------------------------
CREATE TABLE public.integrations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  name text NOT NULL,
  type text NOT NULL,
  base_url text,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  credentials_encrypted bytea NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT integrations_pkey PRIMARY KEY (id),
  CONSTRAINT integrations_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id)
);

CREATE INDEX integrations_tenant_id_idx ON public.integrations (tenant_id);

-- ---------------------------------------------------------------------------
-- automations — a named, ordered step list with a trigger
-- ---------------------------------------------------------------------------
CREATE TABLE public.automations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  agent_id uuid,
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  trigger_type text NOT NULL CHECK (trigger_type IN ('after_agent_reply', 'on_tool_call', 'ai_capture', 'manual')),
  trigger_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT automations_pkey PRIMARY KEY (id),
  CONSTRAINT automations_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id),
  CONSTRAINT automations_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES public.agents(id)
);

CREATE INDEX automations_tenant_id_idx ON public.automations (tenant_id);

-- ---------------------------------------------------------------------------
-- automation_runs — one row per execution, populated by the Inngest function
-- ---------------------------------------------------------------------------
CREATE TABLE public.automation_runs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  automation_id uuid NOT NULL,
  conversation_id uuid,
  contact_id uuid,
  status text NOT NULL DEFAULT 'running'::text CHECK (status IN ('running', 'completed', 'failed')),
  step_results jsonb NOT NULL DEFAULT '[]'::jsonb,
  error text,
  started_at timestamp with time zone NOT NULL DEFAULT now(),
  finished_at timestamp with time zone,
  CONSTRAINT automation_runs_pkey PRIMARY KEY (id),
  CONSTRAINT automation_runs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id),
  CONSTRAINT automation_runs_automation_id_fkey FOREIGN KEY (automation_id) REFERENCES public.automations(id),
  CONSTRAINT automation_runs_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id),
  CONSTRAINT automation_runs_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id)
);

CREATE INDEX automation_runs_tenant_id_idx ON public.automation_runs (tenant_id);
CREATE INDEX automation_runs_automation_id_idx ON public.automation_runs (automation_id);

-- ---------------------------------------------------------------------------
-- Row Level Security — same tenant-scoped pattern as wa_accounts
-- ---------------------------------------------------------------------------
ALTER TABLE public.integrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_all ON public.integrations
  FOR ALL USING (tenant_id IN (SELECT public.auth_tenant_ids()) OR public.is_god_user())
  WITH CHECK (tenant_id IN (SELECT public.auth_tenant_ids()) OR public.is_god_user());

ALTER TABLE public.automations ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_all ON public.automations
  FOR ALL USING (tenant_id IN (SELECT public.auth_tenant_ids()) OR public.is_god_user())
  WITH CHECK (tenant_id IN (SELECT public.auth_tenant_ids()) OR public.is_god_user());

ALTER TABLE public.automation_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_all ON public.automation_runs
  FOR ALL USING (tenant_id IN (SELECT public.auth_tenant_ids()) OR public.is_god_user())
  WITH CHECK (tenant_id IN (SELECT public.auth_tenant_ids()) OR public.is_god_user());