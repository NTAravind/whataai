-- ============================================================================
-- 008_backfill_missing_agent_tools.sql
--
-- Backfill agent_tools for tools added after 004_agent_tool_seed.sql:
--   cancel_booking, list_resources, schedule_reminder
-- ============================================================================

INSERT INTO public.agent_tools (agent_id, tool_name, config, enabled)
SELECT
  a.id AS agent_id,
  t.tool_name,
  '{}'::jsonb AS config,
  true AS enabled
FROM public.agents a
CROSS JOIN (VALUES
  ('cancel_booking'),
  ('list_resources'),
  ('schedule_reminder')
) AS t(tool_name)
WHERE a.enabled = true
ON CONFLICT (agent_id, tool_name) DO NOTHING;

-- ============================================================================
-- End of migration
-- ============================================================================
