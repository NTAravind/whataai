import { supabaseAdmin, unwrap } from "@/lib/clients/supabase";
import { inngest } from "@/lib/clients/ingest";
import { scheduleMessageRun } from "@/lib/inngest/events";

/**
 * Campaign scheduling (mirrors Meta's /schedules API from docs/api-guide.md)
 * plus per-message delayed sends. Timing is handled durably by Inngest via
 * the event `ts` field; `scheduled_messages` is the dashboard-facing record.
 */

export interface ScheduleMessageInput {
  tenantId: string;
  channel: "whatsapp" | "mail";
  channelAccountId: string;
  contactId: string;
  conversationId?: string;
  agentId?: string | null;
  sendAt: string; // ISO timestamp
  content: { type: "text" | "template"; text?: string; meta?: Record<string, unknown> };
  templateId?: string;
}

export async function scheduleMessage(input: ScheduleMessageInput) {
  const admin = supabaseAdmin();

  const { data: scheduled, error } = await admin
    .from("scheduled_messages")
    .insert({
      tenant_id: input.tenantId,
      channel: input.channel,
      wa_account_id: input.channel === "whatsapp" ? input.channelAccountId : null,
      mail_account_id: input.channel === "mail" ? input.channelAccountId : null,
      contact_id: input.contactId,
      conversation_id: input.conversationId ?? null,
      agent_id: input.agentId ?? null,
      send_at: input.sendAt,
      content_type: input.content.type,
      content: input.content as unknown as Record<string, unknown>,
      template_id: input.templateId ?? null,
      status: "scheduled",
    })
    .select()
    .single();
  if (error) throw error;

  const sendAtMs = new Date(input.sendAt).getTime();
  await inngest.send({
    id: `scheduled-${scheduled.id}`,
    name: scheduleMessageRun.name,
    ts: sendAtMs, // Inngest delays the function start until this time
    data: { scheduledMessageId: scheduled.id, tenantId: input.tenantId },
  });

  return scheduled;
}

export async function cancelScheduledMessage(tenantId: string, scheduledId: string) {
  const admin = supabaseAdmin();
  const { data } = await admin
    .from("scheduled_messages")
    .update({ status: "cancelled" })
    .eq("id", scheduledId)
    .eq("tenant_id", tenantId)
    .select()
    .single();
  return data;
}

export async function listScheduledMessages(tenantId: string) {
  return unwrap(
    await supabaseAdmin()
      .from("scheduled_messages")
      .select("*, contact:contacts(id, full_name, phone_number)")
      .eq("tenant_id", tenantId)
      .order("send_at", { ascending: true }),
  );
}

export async function getScheduledMessage(scheduledId: string) {
  return unwrap(
    await supabaseAdmin().from("scheduled_messages").select("*").eq("id", scheduledId).single(),
  );
}

// ---------------------------------------------------------------------------
// Campaigns (Meta /schedules mirror)
// ---------------------------------------------------------------------------

export interface CreateCampaignInput {
  tenantId: string;
  waAccountId: string;
  templateId: string;
  name: string;
  description?: string;
  audienceId: string;
  wabaCsId?: string;
  deliveryTime: string; // ISO
  templateParams?: Record<string, unknown>;
}

export async function createCampaign(input: CreateCampaignInput) {
  const admin = supabaseAdmin();
  const { data, error } = await admin
    .from("campaign_schedules")
    .insert({
      tenant_id: input.tenantId,
      wa_account_id: input.waAccountId,
      template_id: input.templateId,
      name: input.name,
      description: input.description ?? null,
      audience_id: input.audienceId,
      waba_cs_id: input.wabaCsId ?? null,
      delivery_time: input.deliveryTime,
      template_params: input.templateParams ?? {},
      status: "scheduled",
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function cancelCampaign(tenantId: string, campaignId: string) {
  return supabaseAdmin()
    .from("campaign_schedules")
    .update({ status: "cancelled" })
    .eq("id", campaignId)
    .eq("tenant_id", tenantId);
}

export async function listCampaigns(tenantId: string) {
  return unwrap(
    await supabaseAdmin()
      .from("campaign_schedules")
      .select("*, template:whatsapp_templates(name, category, status)")
      .eq("tenant_id", tenantId)
      .order("delivery_time", { ascending: false }),
  );
}

export async function getCampaign(campaignId: string) {
  return unwrap(
    await supabaseAdmin().from("campaign_schedules").select("*").eq("id", campaignId).single(),
  );
}
