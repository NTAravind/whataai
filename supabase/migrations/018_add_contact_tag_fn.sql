-- ============================================================================
-- 018. Automations data-loss hardening
--      (1) atomic add_contact_tag SQL function for the tag_contact step
--      (2) idempotent automation_runs via event_id uniqueness
--      (3) automation_runs_summary view (list payloads exclude step_results)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- (1) add_contact_tag — atomic append-if-absent into contacts.metadata->'tags'.
--     The tag executor previously read-modify-wrote the whole metadata row from
--     the app, which could lose concurrent updates; this function does the whole
--     update in one statement, scoped by (id, tenant_id).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.add_contact_tag(p_tenant uuid, p_contact uuid, p_tag text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  m jsonb;
  tags jsonb;
BEGIN
  SELECT metadata INTO m
    FROM public.contacts
   WHERE id = p_contact AND tenant_id = p_tenant
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'contact % not found for tenant', p_contact;
  END IF;

  tags := COALESCE(m -> 'tags', '[]'::jsonb);
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(tags) AS t WHERE t = p_tag) THEN
    tags := tags || to_jsonb(p_tag);
  END IF;

  UPDATE public.contacts
     SET metadata = jsonb_set(metadata, '{tags}', tags)
   WHERE id = p_contact AND tenant_id = p_tenant;

  RETURN tags;
END;
$$;

-- ----------------------------------------------------------------------------
-- (2) event_id — dedupe key for automation/triggered rebroadcasts. A run is
--     unique per (automation_id, event_id); NULL event_id (runs created without
--     an Inngest event id) are exempt so multiple NULLs remain allowed.
-- ----------------------------------------------------------------------------
ALTER TABLE public.automation_runs ADD COLUMN event_id text;

CREATE UNIQUE INDEX automation_runs_automation_event_idx
  ON public.automation_runs (automation_id, event_id)
  WHERE event_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- (3) Summary view — every run-list query must go through this (or a similarly
--     scoped select) so step_results (which may contain response bodies,
--     including credentials) never leaves the DB in a list payload. getRun
--     still returns the full row for detail views.
-- ----------------------------------------------------------------------------
CREATE VIEW public.automation_runs_summary AS
SELECT
  id,
  tenant_id,
  automation_id,
  conversation_id,
  contact_id,
  status,
  error,
  started_at,
  finished_at,
  jsonb_array_length(step_results) AS steps_count
FROM public.automation_runs;

COMMENT ON VIEW public.automation_runs_summary IS
  'automation_runs without step_results, plus a cheap steps_count. Used by run-history lists.';