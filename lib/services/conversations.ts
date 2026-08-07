import { supabaseAdmin, unwrap } from "@/lib/clients/supabase";

export interface ConversationRow {
  id: string;
  tenant_id: string;
  contact_id: string;
  agent_id: string | null;
  channel: "whatsapp" | "mail";
  wa_account_id: string | null;
  mail_account_id: string | null;
  status: string;
  last_message_at: string | null;
  last_inbound_at: string | null;
  unread_count: number;
  metadata: Record<string, unknown>;
}

export interface ConversationContext {
  conversation: ConversationRow;
  contact: { id: string; full_name: string | null; phone_number: string | null; email: string | null; opt_out: boolean };
  agent: {
    id: string;
    type: string;
    name: string;
    instructions: string;
    model_config: Record<string, unknown>;
    tools: string[];
  } | null;
}

/**
 * Idempotent conversation resolution for inbound messages.
 * One active conversation per (tenant, channel_account, sender).
 */
export async function getOrCreateConversation(input: {
  tenantId: string;
  contactId: string;
  channel: "whatsapp" | "mail";
  channelAccountId: string; // wa_accounts.id or mail_accounts.id
  senderId: string;
  agentId?: string | null;
}): Promise<ConversationRow> {
  const admin = supabaseAdmin();
  const channelAccountCol = input.channel === "whatsapp" ? "wa_account_id" : "mail_account_id";

  const existing = await admin
    .from("conversations")
    .select("*")
    .eq("tenant_id", input.tenantId)
    .eq("contact_id", input.contactId)
    .eq("channel", input.channel)
    .eq(channelAccountCol, input.channelAccountId)
    .eq("status", "active")
    .maybeSingle();

  if (existing.data) return existing.data as ConversationRow;

  const { data, error } = await admin
    .from("conversations")
    .insert({
      tenant_id: input.tenantId,
      contact_id: input.contactId,
      channel: input.channel,
      wa_account_id: input.channel === "whatsapp" ? input.channelAccountId : null,
      mail_account_id: input.channel === "mail" ? input.channelAccountId : null,
      agent_id: input.agentId ?? null,
      status: "active",
      metadata: { sender_id: input.senderId },
    })
    .select()
    .single();

  if (error) {
    // Race between two webhook deliveries — return the winner.
    const retry = await admin
      .from("conversations")
      .select("*")
      .eq("tenant_id", input.tenantId)
      .eq("contact_id", input.contactId)
      .eq("channel", input.channel)
      .eq(channelAccountCol, input.channelAccountId)
      .eq("status", "active")
      .maybeSingle();
    if (retry.data) return retry.data as ConversationRow;
    throw error;
  }
  return data as ConversationRow;
}

export async function loadConversationContext(conversationId: string): Promise<ConversationContext> {
  const admin = supabaseAdmin();

  const { data: conversation, error } = await admin
    .from("conversations")
    .select("*")
    .eq("id", conversationId)
    .single();
  if (error || !conversation) throw new Error(`Conversation ${conversationId} not found`);

  const contact = unwrap(
    await admin.from("contacts").select("*").eq("id", conversation.contact_id).single(),
  );

  let agent: ConversationContext["agent"] = null;
  if (conversation.agent_id) {
    const { data: agentRow, error: agentErr } = await admin
      .from("agents")
      .select("id, type, name, instructions, model_config")
      .eq("id", conversation.agent_id)
      .single();
    if (!agentErr && agentRow) {
      const tools = unwrap(
        await admin
          .from("agent_tools")
          .select("tool_name")
          .eq("agent_id", agentRow.id)
          .eq("enabled", true),
      ).map((t: { tool_name: string }) => t.tool_name);
      agent = { ...agentRow, tools };
    }
  }

  return { conversation: conversation as ConversationRow, contact, agent };
}

export async function listConversations(tenantId: string) {
  return unwrap(
    await supabaseAdmin()
      .from("conversations")
      .select(
        "id, channel, status, last_message_at, last_inbound_at, unread_count, metadata, contact:contacts(id, full_name, phone_number, email), agent:agents(id, name, type)",
      )
      .eq("tenant_id", tenantId)
      .order("last_message_at", { ascending: false })
      .limit(100),
  );
}

export async function getConversation(tenantId: string, conversationId: string) {
  return unwrap(
    await supabaseAdmin()
      .from("conversations")
      .select(
        "id, channel, status, last_message_at, last_inbound_at, unread_count, metadata, contact:contacts(*), agent:agents(id, name, type, instructions)",
      )
      .eq("tenant_id", tenantId)
      .eq("id", conversationId)
      .single(),
  );
}

export async function listMessages(conversationId: string, limit = 100) {
  return unwrap(
    await supabaseAdmin()
      .from("messages")
      .select("*")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true })
      .limit(limit),
  );
}

export async function markConversationRead(conversationId: string) {
  await supabaseAdmin()
    .from("conversations")
    .update({ unread_count: 0 })
    .eq("id", conversationId);
}

export async function setConversationStatus(conversationId: string, status: string) {
  await supabaseAdmin().from("conversations").update({ status }).eq("id", conversationId);
}

/**
 * Pick which agent should handle a conversation: the conversation's own
 * binding, else the tenant's first enabled agent bound to this channel
 * account (docs/guide.md §5 — config-driven, not type-driven).
 */
export async function pickAgentForConversation(input: {
  tenantId: string;
  channel: "whatsapp" | "mail";
  channelAccountId: string;
  preferredAgentId?: string | null;
}): Promise<ConversationContext["agent"] | null> {
  const admin = supabaseAdmin();
  const channelCol = input.channel === "whatsapp" ? "wa_account_id" : "mail_account_id";

  let agentRow: { id: string; type: string; name: string; instructions: string; model_config: Record<string, unknown> } | null = null;

  if (input.preferredAgentId) {
    const { data } = await admin
      .from("agents")
      .select("id, type, name, instructions, model_config")
      .eq("id", input.preferredAgentId)
      .eq("tenant_id", input.tenantId)
      .eq("enabled", true)
      .single();
    agentRow = data ?? null;
  }

  if (!agentRow) {
    const { data } = await admin
      .from("agent_channels")
      .select("agent_id")
      .eq("channel", input.channel)
      .eq(channelCol, input.channelAccountId)
      .eq("enabled", true)
      .limit(1)
      .maybeSingle();
    if (data) {
      const { data: found } = await admin
        .from("agents")
        .select("id, type, name, instructions, model_config")
        .eq("id", data.agent_id)
        .eq("enabled", true)
        .single();
      agentRow = found ?? null;
    }
  }

  if (!agentRow) return null;

  const tools = unwrap(
    await admin.from("agent_tools").select("tool_name").eq("agent_id", agentRow.id).eq("enabled", true),
  ).map((t: { tool_name: string }) => t.tool_name);

  return { ...agentRow, tools };
}
