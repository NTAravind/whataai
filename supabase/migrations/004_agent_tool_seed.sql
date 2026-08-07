-- ============================================================================
-- 004_agent_tool_seed.sql
-- Seed the agent tool registry (docs/guide.md §5).
--
-- The AI SDK tool registry lives in lib/agents/registry.ts (search_knowledge_base,
-- check_availability, create_booking, escalate_to_human, list_templates,
-- send_template, list_flows, trigger_flow). The `agent_tools` table toggles
-- which of those tools each agent is exposed to — adding a capability = one
-- registry entry + one row here, no deploys.
--
-- This backfills every existing enabled agent with the full current toolset,
-- so template management and flow management are available out of the box.
-- `agent_tools` has UNIQUE (agent_id, tool_name), so re-running is idempotent:
-- only missing rows are inserted, existing config/enabled flags are preserved.
-- ============================================================================

INSERT INTO public.agent_tools (agent_id, tool_name, config, enabled)
SELECT
  a.id AS agent_id,
  t.tool_name,
  '{}'::jsonb AS config,
  true AS enabled
FROM public.agents a
CROSS JOIN (VALUES
  ('search_knowledge_base'),
  ('check_availability'),
  ('create_booking'),
  ('escalate_to_human'),
  ('list_templates'),
  ('send_template'),
  ('list_flows'),
  ('trigger_flow')
) AS t(tool_name)
WHERE a.enabled = true
ON CONFLICT (agent_id, tool_name) DO NOTHING;

-- ============================================================================
-- End of migration
-- ============================================================================
