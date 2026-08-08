export interface ConversationSummary {
  id: string;
  channel: "whatsapp" | "mail";
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

export interface MemberRow {
  id: string;
  tenant_id: string;
  user_id: string;
  role: string;
  created_at: string;
}
