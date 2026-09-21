export interface ConversationSummary {
  id: string;
  tenant_id?: string;
  contact_id?: string;
  agent_id?: string | null;
  channel: "whatsapp" | "mail";
  wa_account_id?: string | null;
  mail_account_id?: string | null;
  status: string;
  last_message_at: string | null;
  last_inbound_at: string | null;
  unread_count: number;
  metadata: Record<string, unknown>;
  contact?: {
    id: string;
    full_name: string | null;
    phone_number: string | null;
    email: string | null;
  } | null;
  agent?: { id: string; name: string; type: string } | null;
}

export interface MessageContent {
  type: "text" | "template" | "flow" | "tool_call" | "tool_result";
  text?: string;
  meta?: Record<string, unknown>;
}

export interface MessageRow {
  id: string;
  conversation_id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: MessageContent;
  wa_message_id: string | null;
  mail_message_id: string | null;
  status?: string;
  created_at: string;
}

export interface AgentRow {
  id: string;
  tenant_id: string;
  type: string;
  name: string;
  instructions: string;
  model_config: Record<string, unknown>;
  enabled: boolean;
  tools?: string[];
}

export interface TemplateRow {
  id: string;
  tenant_id: string;
  wa_account_id: string;
  name: string;
  category: string;
  language: string;
  status: string;
  components: Record<string, unknown>[];
  meta_template_id: string | null;
  created_at: string;
}

export interface WaAccountRow {
  id: string;
  tenant_id: string;
  wa_phone_number_id: string;
  display_phone_number: string;
  wa_business_account_id: string;
  status: string;
  metadata: Record<string, unknown>;
  created_at: string;
  has_access_token: boolean;
  has_verify_token: boolean;
}

export interface MailAccountRow {
  id: string;
  tenant_id: string;
  email_address: string;
  provider: string;
  credentials: Record<string, unknown>;
  status: string;
  created_at: string;
}

export interface BusinessRow {
  id: string;
  tenant_id: string;
  name: string;
  industry: string | null;
  timezone: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface KnowledgeDocumentRow {
  id: string;
  tenant_id?: string;
  title: string;
  source_type: string;
  status: string;
  raw_content?: string | null;
  created_at: string;
  updated_at?: string;
}

export interface AppointmentServiceRow {
  id: string;
  business_id: string;
  name: string;
  description: string | null;
  booking_mode: string;
  default_duration_minutes: number | null;
  requires_resource_type: string | null;
  active_schema_id: string | null;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface ResourceRow {
  id: string;
  business_id: string;
  type: string;
  name: string;
  capacity: number | null;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface AvailabilityRuleRow {
  id: string;
  business_id: string;
  resource_id: string | null;
  day_of_week: number;
  start_time: string;
  end_time: string;
  timezone: string;
  created_at: string;
  resource?: { id: string; name: string; type: string } | null;
}

export interface BookingRow {
  id: string;
  start_time: string;
  end_time: string | null;
  status: string;
  booking_data: Record<string, unknown>;
  business?: { name: string } | null;
  service?: { name: string } | null;
  resource?: { name: string } | null;
  customer?: { full_name: string | null; phone_number: string | null } | null;
}

export interface MemberRow {
  id: string;
  tenant_id: string;
  user_id: string;
  role: string;
  created_at: string;
}

export type AutomationTriggerType = "after_agent_reply" | "on_tool_call" | "ai_capture" | "manual";

export interface AutomationStep {
  type: "api_call" | "send_message" | "send_template" | "send_document" | "tag_contact" | "wait";
  integrationId?: string;
  url?: string;
  method?: "GET" | "POST" | "PUT" | "PATCH";
  headers?: Record<string, string>;
  body?: string;
  responseType?: "json" | "binary";
  text?: string;
  templateId?: string;
  mediaId?: string;
  filename?: string;
  tag?: string;
  seconds?: number;
}

export interface CaptureField {
  name: string;
  type: "string" | "number";
  description: string;
  required: boolean;
  saveToContact: boolean;
}

export interface AutomationRow {
  id: string;
  tenant_id: string;
  agent_id: string | null;
  name: string;
  is_active: boolean;
  trigger_type: AutomationTriggerType;
  trigger_config: Record<string, unknown>;
  steps: AutomationStep[];
  created_at: string;
  updated_at: string;
}

export interface AutomationRunRow {
  id: string;
  automation_id: string;
  status: "running" | "completed" | "failed";
  steps_count: number;
  error: string | null;
  started_at: string;
  finished_at: string | null;
  durationMs: number | null;
  contact?: { full_name: string | null; phone_number: string | null };
}

export interface IntegrationRow {
  id: string;
  tenant_id: string;
  name: string;
  type: string;
  base_url: string | null;
  config: Record<string, unknown>;
  hasCredentials: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface EnabledToolsPayload {
  tools: Array<{ name: string; description: string }>;
  agents: Array<{ id: string; name: string; enabledTools: string[] }>;
  captureAutomations: Array<{
    id: string;
    name: string;
    agentId: string | null;
    toolName: string;
    fields: CaptureField[];
  }>;
}
