import { supabaseAdmin, unwrap } from "@/lib/clients/supabase";
import { ModelMessage } from "ai";

export interface ChatSession {
  id: string;
  tenant_id: string;
  user_id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
}

export async function createChatSession(
  tenantId: string,
  userId: string,
  title?: string
): Promise<ChatSession> {
  const { data, error } = await supabaseAdmin()
    .from("chat_sessions")
    .insert({ tenant_id: tenantId, user_id: userId, title })
    .select()
    .single();
  return unwrap({ data, error });
}

export async function getChatSession(
  sessionId: string,
  tenantId: string
): Promise<ChatSession> {
  const { data, error } = await supabaseAdmin()
    .from("chat_sessions")
    .select()
    .eq("id", sessionId)
    .eq("tenant_id", tenantId)
    .single();
  return unwrap({ data, error });
}

export async function listChatSessions(
  tenantId: string,
  userId: string
): Promise<ChatSession[]> {
  const { data, error } = await supabaseAdmin()
    .from("chat_sessions")
    .select()
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });
  return unwrap({ data, error });
}

export async function getChatHistory(sessionId: string): Promise<ModelMessage[]> {
  const { data, error } = await supabaseAdmin()
    .from("chat_messages")
    .select("role, content")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });

  const rows = unwrap({ data, error });
  return rows.map((row) => ({
    role: row.role as ModelMessage["role"],
    content: row.content,
  })) as ModelMessage[];
}

export async function appendChatMessages(
  sessionId: string,
  messages: { role: string; content: unknown }[]
): Promise<void> {
  if (messages.length === 0) return;
  const inserts = messages.map((m) => ({
    session_id: sessionId,
    role: m.role,
    content: m.content,
  }));

  await supabaseAdmin().from("chat_messages").insert(inserts);
  await supabaseAdmin()
    .from("chat_sessions")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", sessionId);
}

export async function deleteChatSession(
  sessionId: string,
  tenantId: string
): Promise<void> {
  await supabaseAdmin()
    .from("chat_sessions")
    .delete()
    .eq("id", sessionId)
    .eq("tenant_id", tenantId);
}

export async function autoTitleSession(
  sessionId: string,
  firstMessage: string
): Promise<void> {
  const title =
    firstMessage.length > 50 ? firstMessage.substring(0, 47) + "..." : firstMessage;
  await supabaseAdmin()
    .from("chat_sessions")
    .update({ title })
    .eq("id", sessionId);
}
