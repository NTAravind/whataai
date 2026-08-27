import { ModelMessage, streamText } from "ai";
import { buildTenantAgentTools } from "./tenant-tools";
import { google } from "@ai-sdk/google";
import { getBusinessContextPrompt } from "@/lib/services/businesses";

export interface StreamTenantAgentInput {
  tenantId: string;
  messages: ModelMessage[];
  history: ModelMessage[];
  onFinish?: (event: any) => Promise<void> | void;
}

export async function streamTenantAgent({
  tenantId,
  messages,
  history,
  onFinish,
}: StreamTenantAgentInput) {
  const tools = buildTenantAgentTools(tenantId);

  // Try to load business context if they have one
  let businessContext = "";
  try {
    const ctx = await getBusinessContextPrompt(tenantId);
    businessContext = `\nBusiness Context:\n${ctx.prompt}\nTimezone: ${ctx.timezone}`;
  } catch {
    businessContext = "\nBusiness Context: Not configured yet.";
  }

  const systemPrompt = `You are WhataAI Assistant — an intelligent business operations co-pilot for the tenant
who is currently logged in. You help them manage their entire WhatsApp business platform
through natural conversation.

IDENTITY & TONE
- You are concise, action-oriented, and proactive.
- After completing an action, always summarise what you did and ask what's next.
- If something is ambiguous, ask ONE clarifying question before acting on bulk operations.
- Use emojis sparingly (✅ done, ⚠️ warning, 📋 list).
${businessContext}

WHATSAPP TEMPLATE RULES
1. Template names: lowercase, underscores only (e.g. sale_announcement_v1).
2. Variables use {{1}}, {{2}} etc.
3. Category must be MARKETING, UTILITY, or AUTHENTICATION.
4. Body text: max 1024 characters. Footer: max 60 characters.
5. Max 3 quick-reply buttons or 2 CTA buttons.

BULK OPERATIONS SAFETY
- For bulk_send_template: always call list_contacts first to get exact count,
  then confirm count before executing.
- Never send bulk without explicit "yes", "proceed", or "confirm".

TEMPLATE PREVIEW
When create_template is called, it returns a JSON block starting with {"__type":"PENDING_PREVIEW"}.
Tell the user: "Here is a preview of the template. Approve it or tell me what to change."
Do NOT output the raw JSON verbatim — the UI intercepts and renders it as a preview.
`;

  return streamText({
    model: google("gemini-1.5-pro"),
    system: systemPrompt,
    messages: [...history, ...messages],
    tools,
    onFinish,
  });
}
