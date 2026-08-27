import { requireTenantAccess } from "@/lib/auth/guard";
import { handleError, ok } from "@/lib/http";
import {
  getConversation,
  listMessages,
  markConversationRead,
  setConversationStatus,
} from "@/lib/services/conversations";
import { enqueueOutboundMessage } from "@/lib/services/messages";

type Ctx = { params: Promise<{ tenantId: string; conversationId: string }> };

interface ConversationRow {
  id: string;
  tenant_id: string;
  channel: "whatsapp" | "mail";
  status: string;
  wa_account_id: string | null;
  mail_account_id: string | null;
  contact_id: string | null;
  agent_id: string | null;
  metadata: Record<string, unknown>;
  contact?: { phone_number: string | null; email: string | null } | null;
}

export async function GET(_request: Request, { params }: Ctx) {
  try {
    const { tenantId, conversationId } = await params;
    await requireTenantAccess(tenantId);
    const conversation = await getConversation(tenantId, conversationId);
    const messages = await listMessages(conversationId);
    await markConversationRead(conversationId);
    return ok({ conversation, messages });
  } catch (e) {
    return handleError(e);
  }
}

export async function POST(request: Request, { params }: Ctx) {
  try {
    const { tenantId, conversationId } = await params;
    await requireTenantAccess(tenantId);

    const conversation = (await getConversation(tenantId, conversationId)) as unknown as ConversationRow;
    const body = (await request.json()) as { text?: string };
    const text = body.text?.trim();
    if (!text) return handleError(new Error("text is required"));

    if (conversation.channel !== "whatsapp") {
      return handleError(new Error("Replying from the dashboard is only supported for WhatsApp conversations"));
    }
    const channelAccountId = conversation.wa_account_id ?? conversation.mail_account_id;
    if (!channelAccountId) {
      return handleError(new Error("Conversation has no bound channel account"));
    }
    if (!conversation.contact_id) {
      return handleError(new Error("Conversation has no contact"));
    }

    const senderId =
      (conversation.metadata?.sender_id as string | undefined) ??
      conversation.contact?.phone_number ??
      conversation.contact?.email;

    const message = await enqueueOutboundMessage({
      tenantId,
      channel: conversation.channel,
      channelAccountId,
      conversationId,
      contactId: conversation.contact_id,
      senderId: senderId ?? "",
      content: { type: "text", text },
      agentId: conversation.agent_id ?? null,
    });

    return ok({ message });
  } catch (e) {
    return handleError(e);
  }
}

export async function PATCH(request: Request, { params }: Ctx) {
  try {
    const { tenantId, conversationId } = await params;
    await requireTenantAccess(tenantId);
    const body = (await request.json()) as { status?: string };
    if (!body.status) return handleError(new Error("status is required"));
    await setConversationStatus(conversationId, body.status);
    return ok({ status: body.status });
  } catch (e) {
    return handleError(e);
  }
}
