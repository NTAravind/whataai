import { supabaseAdmin } from "@/lib/clients/supabase";
import { getOrCreateContact } from "@/lib/services/contacts";
import { getOrCreateConversation } from "@/lib/services/conversations";
import { enqueueOutboundMessage } from "@/lib/services/messages";
import { getTemplate } from "@/lib/services/templates";

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

interface WaAccountRef {
  tenantId?: string;
  waAccountId?: string;
  waPhoneNumberId?: string;
}

interface WaAccountRow {
  id: string;
  tenant_id: string;
  wa_phone_number_id: string | null;
}

/**
 * Resolve the WhatsApp account a send targets. The dashboard passes the
 * wa_accounts.id; callers without one can pass the Meta phone number id.
 */
async function resolveWaAccount(ref: WaAccountRef): Promise<WaAccountRow> {
  const admin = supabaseAdmin();
  if (!ref.waAccountId && !ref.waPhoneNumberId) {
    throw new HttpError(400, "waAccountId or waPhoneNumberId is required");
  }

  let query = admin.from("wa_accounts").select("*");
  if (ref.waAccountId) query = query.eq("id", ref.waAccountId);
  else query = query.eq("wa_phone_number_id", ref.waPhoneNumberId);

  const { data, error } = await query.maybeSingle();
  if (error || !data) throw new HttpError(404, "WhatsApp account not found");
  const wa = data as WaAccountRow;
  if (ref.tenantId && ref.tenantId !== wa.tenant_id) {
    throw new HttpError(403, "WhatsApp account does not belong to this tenant");
  }
  return wa;
}

async function resolveConversation(input: {
  tenantId: string;
  contactId: string;
  channelAccountId: string;
  senderId: string;
  conversationId?: string;
}): Promise<string> {
  if (input.conversationId) {
    const { data, error } = await supabaseAdmin()
      .from("conversations")
      .select("id")
      .eq("id", input.conversationId)
      .eq("tenant_id", input.tenantId)
      .maybeSingle();
    if (error || !data) throw new HttpError(404, "Conversation not found for tenant");
    return input.conversationId;
  }

  const conversation = await getOrCreateConversation({
    tenantId: input.tenantId,
    contactId: input.contactId,
    channel: "whatsapp",
    channelAccountId: input.channelAccountId,
    senderId: input.senderId,
  });
  return conversation.id;
}

export interface SendWhatsAppTextInput extends WaAccountRef {
  to: string;
  text: string;
  conversationId?: string;
}

export async function sendWhatsAppText(input: SendWhatsAppTextInput) {
  if (!input.to || !input.text) throw new HttpError(400, "to and text are required");

  const wa = await resolveWaAccount(input);
  const tenantId = input.tenantId ?? wa.tenant_id;

  const contact = await getOrCreateContact(tenantId, input.to, null);
  if (contact.opt_out) throw new HttpError(403, "Contact has opted out");

  const conversationId = await resolveConversation({
    tenantId,
    contactId: contact.id,
    channelAccountId: wa.id,
    senderId: input.to,
    conversationId: input.conversationId,
  });

  const message = await enqueueOutboundMessage({
    tenantId,
    channel: "whatsapp",
    channelAccountId: wa.id,
    conversationId,
    contactId: contact.id,
    senderId: input.to,
    content: { type: "text", text: input.text },
  });

  return { messageId: message.id, conversationId, status: "queued" };
}

export interface SendWhatsAppTemplateInput extends WaAccountRef {
  to: string;
  templateId: string;
  params?: Record<string, unknown>;
  conversationId?: string;
}

export async function sendWhatsAppTemplate(input: SendWhatsAppTemplateInput) {
  if (!input.to || !input.templateId) throw new HttpError(400, "to and templateId are required");

  const wa = await resolveWaAccount(input);
  const tenantId = input.tenantId ?? wa.tenant_id;

  const template = await getTemplate(input.templateId, tenantId);
  if (template.wa_account_id !== wa.id) {
    throw new HttpError(400, "Template does not belong to this WhatsApp account");
  }
  if (template.status !== "approved") {
    throw new HttpError(400, `Template is not approved (status: ${template.status})`);
  }

  const contact = await getOrCreateContact(tenantId, input.to, null);
  if (contact.opt_out) throw new HttpError(403, "Contact has opted out");

  const conversationId = await resolveConversation({
    tenantId,
    contactId: contact.id,
    channelAccountId: wa.id,
    senderId: input.to,
    conversationId: input.conversationId,
  });

  const message = await enqueueOutboundMessage({
    tenantId,
    channel: "whatsapp",
    channelAccountId: wa.id,
    conversationId,
    contactId: contact.id,
    senderId: input.to,
    content: { type: "template", meta: { template_id: template.id, params: input.params ?? {} } },
    templateId: template.id,
  });

  return { messageId: message.id, conversationId, status: "queued" };
}

/** Utility/service message — a UTILITY-category template (session-window expired, etc.). */
export async function sendUtilityMessage(input: SendWhatsAppTemplateInput) {
  if (!input.templateId) throw new HttpError(400, "templateId is required for a service message");

  const wa = await resolveWaAccount(input);
  const tenantId = input.tenantId ?? wa.tenant_id;

  const template = await getTemplate(input.templateId, tenantId);
  if (template.wa_account_id !== wa.id) {
    throw new HttpError(400, "Template does not belong to this WhatsApp account");
  }
  if (template.category !== "UTILITY") {
    throw new HttpError(400, "Service messages require a UTILITY-category template");
  }

  return sendWhatsAppTemplate(input);
}
