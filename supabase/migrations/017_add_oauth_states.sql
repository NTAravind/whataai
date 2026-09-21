-- 017_add_oauth_states.sql
--
-- Short-lived OAuth `state` rows for the generic provider OAuth flow
-- (Part C). When a tenant clicks "Connect with {Provider}", the start route
-- writes a row keyed by a random state; the callback route consumes it
-- (deletes on read, failing if missing or older than 10 minutes). No cleanup
-- job needed for v1 because every read path expires-and-deletes.

CREATE TABLE public.oauth_states (
  state text NOT NULL,
  tenant_id uuid NOT NULL,
  provider_type text NOT NULL,
  integration_name text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT oauth_states_pkey PRIMARY KEY (state),
  CONSTRAINT oauth_states_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id)
);

CREATE INDEX oauth_states_tenant_id_idx ON public.oauth_states (tenant_id);

-- The callback route must read `state` before any tenant context exists, so
-- it needs SELECT on oauth_states for the tenant it will write back to.
ALTER TABLE public.oauth_states ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_all ON public.oauth_states
  FOR ALL USING (tenant_id IN (SELECT public.auth_tenant_ids()) OR public.is_god_user())
  WITH CHECK (tenant_id IN (SELECT public.auth_tenant_ids()) OR public.is_god_user());