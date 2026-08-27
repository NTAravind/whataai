-- ============================================================================
-- 009_backfill_template_and_datetime_tools.sql
--
-- Backfill agent_tools for tools added after 008:
--   create_template, get_current_datetime
-- ============================================================================

INSERT INTO public.agent_tools (agent_id, tool_name, config, enabled)
SELECT
  a.id AS agent_id,
  t.tool_name,
  '{}'::jsonb AS config,
  true AS enabled
FROM public.agents a
CROSS JOIN (VALUES
  ('create_template'),
  ('get_current_datetime')
) AS t(tool_name)
WHERE a.enabled = true
ON CONFLICT (agent_id, tool_name) DO NOTHING;

-- ============================================================================
-- End of migration
-- ============================================================================
