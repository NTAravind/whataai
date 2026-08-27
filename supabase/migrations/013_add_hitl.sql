-- supabase/migrations/013_add_hitl.sql

ALTER TABLE agent_tools
  ADD COLUMN approval_required boolean DEFAULT false;

CREATE TABLE agent_pending_actions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  thread_id text NOT NULL,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  tool_name text NOT NULL,
  tool_args jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by uuid,
  reviewed_at timestamptz,
  rejection_reason text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_pending_actions_thread ON agent_pending_actions(thread_id);
CREATE INDEX idx_pending_actions_tenant ON agent_pending_actions(tenant_id, status);
CREATE INDEX idx_pending_actions_conversation ON agent_pending_actions(conversation_id, status);

UPDATE agent_tools SET approval_required = true
WHERE tool_name IN ('send_template', 'create_booking', 'cancel_booking', 'trigger_flow', 'create_template');
